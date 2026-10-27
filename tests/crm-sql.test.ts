import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

let db: PGlite;
let agenda: string;
let sessao: string;
let inscricao: string;

beforeEach(async () => {
  db = await bancoComMigracoes();
  agenda = (await db.query<{ id: string }>("insert into agendas (nome, slug) values ('V', 'v-crm') returning id")).rows[0].id;
  sessao = (
    await db.query<{ id: string }>("insert into sessoes (agenda_id, inicio, vagas) values ($1, now() + interval '1 day', 10) returning id", [
      agenda,
    ])
  ).rows[0].id;
  inscricao = (
    await db.query<{ id: string }>(
      "insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp) values ($1, $2, 'abcdefghjk', 'Maria', '+551137654321') returning id",
      [sessao, agenda],
    )
  ).rows[0].id;
});

describe("colunas novas", () => {
  it("agendas ganha crm_urls e crm_segredo", async () => {
    const { rows } = await db.query<{ crm_urls: Record<string, string>; crm_segredo: string | null }>(
      "select crm_urls, crm_segredo from agendas where id = $1",
      [agenda],
    );
    expect(rows[0]).toEqual({ crm_urls: {}, crm_segredo: null });
  });

  it("sessoes ganha avaliada_em", async () => {
    const { rows } = await db.query<{ avaliada_em: string | null }>("select avaliada_em from sessoes where id = $1", [sessao]);
    expect(rows[0].avaliada_em).toBeNull();
  });
});

describe("presencas", () => {
  it("peer_id é único", async () => {
    await db.query(
      "insert into presencas (sessao_id, inscricao_id, peer_id, entrou_em) values ($1, $2, 'p1', now())",
      [sessao, inscricao],
    );
    await expect(
      db.query("insert into presencas (sessao_id, inscricao_id, peer_id, entrou_em) values ($1, $2, 'p1', now())", [sessao, inscricao]),
    ).rejects.toThrow();
  });
});

describe("eventos", () => {
  it("recusa nome de evento desconhecido", async () => {
    await expect(
      db.query(
        "insert into eventos (id_evento, evento, inscricao_id, agenda_id, corpo) values ('x:1:1', 'invalido', $1, $2, '{}')",
        [inscricao, agenda],
      ),
    ).rejects.toThrow();
  });

  it("aceita os 6 nomes do spec", async () => {
    const nomes = ["agendou", "lembrete_24h", "lembrete_1h", "comecou", "faltou", "compareceu"];
    for (const [i, nome] of nomes.entries()) {
      await db.query(
        "insert into eventos (id_evento, evento, inscricao_id, agenda_id, corpo) values ($1, $2, $3, $4, '{}')",
        [`${nome}:1:${i}`, nome, inscricao, agenda],
      );
    }
    const { rows } = await db.query<{ total: number }>("select count(*)::int as total from eventos");
    expect(rows[0].total).toBe(6);
  });
});

describe("eventos.mensagem", () => {
  it("nasce nula e volta no reivindicar_eventos (reuso no reenvio)", async () => {
    await db.query("select enfileirar_evento('agendou:x:y', 'agendou', $1, $2, $3, '{}'::jsonb, false)", [inscricao, sessao, agenda]);
    const antes = await db.query<{ mensagem: string | null }>("select mensagem from eventos");
    expect(antes.rows[0].mensagem).toBeNull();
    await db.query("update eventos set mensagem = 'Oi!'");
    const { rows } = await db.query<{ mensagem: string | null }>("select mensagem from reivindicar_eventos(10, now() + interval '1 minute')");
    expect(rows[0].mensagem).toBe("Oi!");
  });
});

describe("enfileirar_evento", () => {
  it("devolve true na 1ª vez e false na 2ª com o mesmo id_evento", async () => {
    const a = await db.query<{ ok: boolean }>(
      "select enfileirar_evento($1, 'agendou', $2, $3, $4, '{}', false) as ok",
      ["agendou:i1:s1", inscricao, sessao, agenda],
    );
    expect(a.rows[0].ok).toBe(true);
    const b = await db.query<{ ok: boolean }>(
      "select enfileirar_evento($1, 'agendou', $2, $3, $4, '{}', false) as ok",
      ["agendou:i1:s1", inscricao, sessao, agenda],
    );
    expect(b.rows[0].ok).toBe(false);
  });

  it("com p_sem_destino = true, nasce com status sem_destino", async () => {
    await db.query("select enfileirar_evento($1, 'agendou', $2, $3, $4, '{}', true)", ["agendou:i2:s1", inscricao, sessao, agenda]);
    const { rows } = await db.query<{ status: string }>("select status from eventos where id_evento = 'agendou:i2:s1'");
    expect(rows[0].status).toBe("sem_destino");
  });
});

describe("reivindicar_eventos", () => {
  it("duas chamadas seguidas com o mesmo p_agora: a 2ª não devolve nada; linhas que vencem depois não entram", async () => {
    await db.query("select enfileirar_evento('agendou:i1:s1', 'agendou', $1, $2, $3, '{}', false)", [inscricao, sessao, agenda]);
    await db.query("select enfileirar_evento('lembrete_1h:i1:s1', 'lembrete_1h', $1, $2, $3, '{}', false)", [inscricao, sessao, agenda]);
    await db.query("insert into eventos (id_evento, evento, inscricao_id, sessao_id, agenda_id, corpo, status, proxima_em) values ('comecou:i1:s1','comecou',$1,$2,$3,'{}','pendente', now() + interval '1 hour')", [
      inscricao,
      sessao,
      agenda,
    ]);
    // Captura "agora" depois de inserir (proxima_em usa o default/now() do próprio Postgres, não o relógio do Node).
    const { rows: nowRows } = await db.query<{ agora: string }>("select now() as agora");
    const agora = nowRows[0].agora;

    const primeira = await db.query<{ id_evento: string }>("select * from reivindicar_eventos(10, $1)", [agora]);
    expect(primeira.rows.map((r) => r.id_evento).sort()).toEqual(["agendou:i1:s1", "lembrete_1h:i1:s1"]);

    const segunda = await db.query("select * from reivindicar_eventos(10, $1)", [agora]);
    expect(segunda.rows).toHaveLength(0);
  });
});

describe("RLS", () => {
  it("liga em presencas e eventos", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('presencas','eventos') order by 1",
    );
    expect(rows).toEqual([
      { relname: "eventos", relrowsecurity: true },
      { relname: "presencas", relrowsecurity: true },
    ]);
  });
});

describe("migração do CRM: sessões antigas", () => {
  it("marca como avaliadas as sessões que já começaram (sem histórico de presença, não viram faltou)", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261023120000_crm.sql"), "utf8");
    expect(sql).toContain("update public.sessoes set avaliada_em = now() where inicio < now();");
    expect(sql.indexOf("add column avaliada_em")).toBeLessThan(sql.indexOf("update public.sessoes set avaliada_em"));
  });
});

describe("inscricoes.agendado_em", () => {
  async function inscrever(sessaoId: string, codigo: string, whatsapp: string) {
    const { rows } = await db.query<{ resultado: string; inscricao_id: string }>(
      "select * from inscrever($1, $2, 'Lead', $3, null, null, null, '{}'::jsonb, 'pagina')",
      [sessaoId, codigo, whatsapp],
    );
    return rows[0];
  }

  it("nasce preenchido e a migração copia created_at nas inscrições antigas", async () => {
    const { rows } = await db.query<{ agendado_em: string | null }>("select agendado_em from inscricoes where id = $1", [inscricao]);
    expect(rows[0].agendado_em).not.toBeNull();
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261023120000_crm.sql"), "utf8");
    expect(sql).toContain("update public.inscricoes set agendado_em = created_at;");
  });

  it("reagendar pra outra sessão atualiza agendado_em", async () => {
    const outra = (
      await db.query<{ id: string }>("insert into sessoes (agenda_id, inicio, vagas) values ($1, now() + interval '3 days', 10) returning id", [agenda])
    ).rows[0].id;
    await db.query("update inscricoes set agendado_em = '2020-01-01T00:00:00Z' where id = $1", [inscricao]);
    const r = await inscrever(outra, "bbbbbbbbbb", "+551137654321");
    expect(r.resultado).toBe("reagendada");
    expect(r.inscricao_id).toBe(inscricao);
    const { rows } = await db.query<{ agendado_em: Date; sessao_id: string }>("select agendado_em, sessao_id from inscricoes where id = $1", [inscricao]);
    expect(rows[0].sessao_id).toBe(outra);
    expect(new Date(rows[0].agendado_em).getFullYear()).toBeGreaterThan(2020);
  });
});

describe("inscrever fecha inscrições velhas pelo que aconteceu", () => {
  async function sessaoPassada(status = "encerrada") {
    return (
      await db.query<{ id: string }>(
        "insert into sessoes (agenda_id, inicio, vagas, status) values ($1, now() - interval '1 day', 10, $2) returning id",
        [agenda, status],
      )
    ).rows[0].id;
  }
  async function inscricaoEm(sessaoId: string, whatsapp: string) {
    return (
      await db.query<{ id: string }>(
        "insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp) values ($1, $2, $3, 'Lead', $4) returning id",
        [sessaoId, agenda, `c${whatsapp.slice(-9)}`, whatsapp],
      )
    ).rows[0].id;
  }
  async function statusDe(id: string) {
    return (await db.query<{ status: string }>("select status from inscricoes where id = $1", [id])).rows[0].status;
  }
  async function inscreverNaFutura(whatsapp: string) {
    await db.query("select * from inscrever($1, 'novocodigo', 'Lead', $2, null, null, null, '{}'::jsonb, 'pagina')", [sessao, whatsapp]);
  }

  it("com presença na sala vira compareceu", async () => {
    const velha = await sessaoPassada();
    const id = await inscricaoEm(velha, "+551131111111");
    await db.query("insert into presencas (sessao_id, inscricao_id, peer_id, entrou_em) values ($1, $2, 'px', now() - interval '1 day')", [velha, id]);
    await inscreverNaFutura("+551131111111");
    expect(await statusDe(id)).toBe("compareceu");
  });

  it("sem presença vira faltou", async () => {
    const velha = await sessaoPassada();
    const id = await inscricaoEm(velha, "+551132222222");
    await inscreverNaFutura("+551132222222");
    expect(await statusDe(id)).toBe("faltou");
  });

  it("sessão cancelada vira cancelado (mesmo com presença)", async () => {
    const velha = await sessaoPassada("cancelada");
    const id = await inscricaoEm(velha, "+551133333333");
    await db.query("insert into presencas (sessao_id, inscricao_id, peer_id, entrou_em) values ($1, $2, 'py', now() - interval '1 day')", [velha, id]);
    await inscreverNaFutura("+551133333333");
    expect(await statusDe(id)).toBe("cancelado");
  });
});
