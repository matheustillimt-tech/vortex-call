import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { minutosDoLead } from "@/src/lib/regras/dashboard";
import { notaInteracao } from "@/src/lib/regras/interacao";
import { bancoComMigracoes } from "./banco";

const MEMBRO = "11111111-1111-4111-8111-111111111111";
const ESTRANHO = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
let agenda: string;
let seq = 0;

async function comoLogado(uid: string) {
  await db.query("select set_config('app.uid', $1, false)", [uid]);
  await db.exec("set role authenticated");
}

async function sessao(inicio: string, status = "encerrada", ag = agenda): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into sessoes (agenda_id, inicio, vagas, status, titulo) values ($1, $2, 30, $3, 'Call') returning id",
    [ag, inicio, status],
  );
  return rows[0].id;
}

async function inscricao(sessaoId: string, status = "agendado", minutos = 0, ag = agenda): Promise<string> {
  seq++;
  const codigo = `c${String(seq).padStart(9, "0")}`;
  const { rows } = await db.query<{ id: string }>(
    "insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp, status, minutos_na_sala) values ($1, $2, $3, 'Lead', $4, $5, $6) returning id",
    [sessaoId, ag, codigo, `+55119${String(seq).padStart(8, "0")}`, status, minutos],
  );
  return rows[0].id;
}

async function presenca(sessaoId: string, inscricaoId: string, entrou: string, saiu: string | null) {
  seq++;
  await db.query("insert into presencas (sessao_id, inscricao_id, peer_id, entrou_em, saiu_em) values ($1, $2, $3, $4, $5)", [
    sessaoId,
    inscricaoId,
    `peer-${seq}`,
    entrou,
    saiu,
  ]);
}

async function venda(inscricaoId: string | null, valor: number, status = "aprovada") {
  seq++;
  await db.query("insert into vendas (order_id, status, valor_centavos, inscricao_id) values ($1, $2, $3, $4)", [
    `ord-${seq}`,
    status,
    valor,
    inscricaoId,
  ]);
}

beforeEach(async () => {
  db = await bancoComMigracoes();
  await db.query("insert into auth.users (id, email) values ($1, 'ana@x.com'), ($2, 'bia@x.com')", [MEMBRO, ESTRANHO]);
  await db.query("insert into usuarios (auth_id, nome, email) values ($1, 'Ana', 'ana@x.com')", [MEMBRO]);
  // Ana (membro) é a vendedora da agenda: vê os dados dela (o recorte por agenda tem testes em vendedor-sql.test.ts).
  const { rows } = await db.query<{ id: string }>(
    "insert into agendas (nome, slug, duracao_min, responsavel_id) select 'Vendas', 'vendas', 60, id from usuarios where auth_id = $1 returning id",
    [MEMBRO],
  );
  agenda = rows[0].id;
});

describe("tabelas novas", () => {
  it("atividade_lead e vendas têm RLS e a equipe só lê", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('atividade_lead', 'vendas') order by 1",
    );
    expect(rows).toEqual([
      { relname: "atividade_lead", relrowsecurity: true },
      { relname: "vendas", relrowsecurity: true },
    ]);
    const s = await sessao("2026-10-20T12:00:00Z");
    await venda(await inscricao(s), 1000);
    await db.query("update vendas set sessao_id = $1", [s]);
    await comoLogado(MEMBRO);
    expect((await db.query("select * from vendas")).rows).toHaveLength(1);
    await expect(db.query("insert into vendas (order_id, status) values ('x', 'aprovada')")).rejects.toThrow();
    await db.exec("reset role");
    await comoLogado(ESTRANHO);
    expect((await db.query("select * from vendas")).rows).toHaveLength(0);
    await db.exec("reset role");
  });

  it("vendas: order_id único e status só aprovada/reembolsada", async () => {
    await db.query("insert into vendas (order_id, status) values ('o1', 'aprovada')");
    await expect(db.query("insert into vendas (order_id, status) values ('o1', 'aprovada')")).rejects.toThrow();
    await expect(db.query("insert into vendas (order_id, status) values ('o2', 'pendente')")).rejects.toThrow();
  });

  it("excluir a sessão leva gravações e atividade junto; venda só perde o vínculo", async () => {
    const s = await sessao("2026-10-20T12:00:00Z", "ao_vivo");
    const i = await inscricao(s);
    await db.query("insert into gravacoes (sessao_id, rtk_recording_id, status, r2_chave) values ($1, 'rec1', 'UPLOADED', 'gravacoes/s_x.mp4')", [s]);
    await db.query("select somar_atividade($1, $2, 10, 10, 1)", [i, s]);
    await venda(i, 500);
    await db.query("update vendas set sessao_id = $1", [s]);
    await db.query("delete from sessoes where id = $1", [s]);
    expect((await db.query("select * from gravacoes")).rows).toHaveLength(0);
    expect((await db.query("select * from atividade_lead")).rows).toHaveLength(0);
    expect((await db.query("select inscricao_id, sessao_id from vendas")).rows).toEqual([{ inscricao_id: null, sessao_id: null }]);
  });

  it("excluir a reunião leva a gravação junto", async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into reunioes (codigo, expira_em) values ('abcdefghij', now() + interval '1 day') returning id",
    );
    await db.query("insert into gravacoes (reuniao_id, rtk_recording_id, status) values ($1, 'rec2', 'UPLOADED')", [rows[0].id]);
    await db.query("delete from reunioes where id = $1", [rows[0].id]);
    expect((await db.query("select * from gravacoes")).rows).toHaveLength(0);
  });
});

describe("somar_atividade", () => {
  it("soma com tetos por chamada e negativos viram 0", async () => {
    const s = await sessao("2026-10-20T12:00:00Z", "ao_vivo");
    const i = await inscricao(s);
    expect((await db.query<{ ok: boolean }>("select somar_atividade($1, $2, 100, 20, 50) as ok", [i, s])).rows[0].ok).toBe(true);
    await db.query("select somar_atividade($1, $2, 10, -5, -1)", [i, s]);
    const { rows } = await db.query("select mic_s, cam_s, msgs from atividade_lead where inscricao_id = $1", [i]);
    expect(rows).toEqual([{ mic_s: 45, cam_s: 20, msgs: 20 }]);
  });

  it("não soma fora do ao vivo nem com inscrição de outra sessão", async () => {
    const encerrada = await sessao("2026-10-20T12:00:00Z", "encerrada");
    const aoVivo = await sessao("2026-10-21T12:00:00Z", "ao_vivo");
    const i = await inscricao(encerrada);
    const j = await inscricao(aoVivo);
    expect((await db.query<{ ok: boolean }>("select somar_atividade($1, $2, 10, 10, 1) as ok", [i, encerrada])).rows[0].ok).toBe(false);
    expect((await db.query<{ ok: boolean }>("select somar_atividade($1, $2, 10, 10, 1) as ok", [i, aoVivo])).rows[0].ok).toBe(false);
    expect((await db.query("select * from atividade_lead")).rows).toHaveLength(0);
    expect((await db.query<{ ok: boolean }>("select somar_atividade($1, $2, 10, 10, 1) as ok", [j, aoVivo])).rows[0].ok).toBe(true);
  });

  it("não soma pra inscrição cancelada", async () => {
    const s = await sessao("2026-10-20T12:00:00Z", "ao_vivo");
    const i = await inscricao(s, "cancelado");
    expect((await db.query<{ ok: boolean }>("select somar_atividade($1, $2, 10, 10, 1) as ok", [i, s])).rows[0].ok).toBe(false);
    expect((await db.query("select * from atividade_lead")).rows).toHaveLength(0);
  });

  it("só o servidor chama", async () => {
    const s = await sessao("2026-10-20T12:00:00Z", "ao_vivo");
    const i = await inscricao(s);
    await comoLogado(MEMBRO);
    await expect(db.query("select somar_atividade($1, $2, 1, 1, 1)", [i, s])).rejects.toThrow();
    await db.exec("reset role");
  });
});

describe("nota_interacao (SQL como o JS)", () => {
  it("bate com notaInteracao em vários casos", async () => {
    const casos = [
      { minutos: 60, duracaoMin: 60, msgs: 5, micS: 120, camS: 1800 },
      { minutos: 45, duracaoMin: 60, msgs: 2, micS: 60, camS: 900 },
      { minutos: 0, duracaoMin: 60, msgs: 0, micS: 0, camS: 0 },
      { minutos: 13, duracaoMin: 45, msgs: 1, micS: 37, camS: 222 },
      { minutos: 7, duracaoMin: 90, msgs: 3, micS: 200, camS: 10 },
      { minutos: 29, duracaoMin: 30, msgs: 4, micS: 119, camS: 899 },
      { minutos: 200, duracaoMin: 15, msgs: 99, micS: 999, camS: 9999 },
    ];
    for (let k = 0; k < 40; k++) {
      casos.push({
        minutos: (k * 7) % 130,
        duracaoMin: 15 + ((k * 11) % 120),
        msgs: k % 9,
        micS: (k * 13) % 180,
        camS: (k * 97) % 4000,
      });
    }
    for (const c of casos) {
      const { rows } = await db.query<{ nota: number }>("select nota_interacao($1, $2, $3, $4, $5) as nota", [
        c.minutos,
        c.duracaoMin,
        c.msgs,
        c.micS,
        c.camS,
      ]);
      expect(rows[0].nota, JSON.stringify(c)).toBe(notaInteracao(c));
    }
  });
});

describe("funções do dashboard", () => {
  // Sessão de 60 min em 20/10 12:00 UTC com 4 inscritos (1 cancelado fora da conta):
  // A: compareceu (avaliada, 55 min), msgs 5, mic 120, cam 1800 → nota 97; comprou 2 vezes (1000 + 500) + 1 reembolso
  // B: presença 12:00–12:20 e 12:10–12:30 (une = 30 min), sem atividade → nota 20
  // C: agendado sem presença → não veio
  // D: cancelado → fora
  let s1: string;
  let s2: string;
  let a: string;
  let b: string;

  beforeEach(async () => {
    s1 = await sessao("2026-10-20T12:00:00Z", "ao_vivo");
    a = await inscricao(s1, "compareceu", 55);
    b = await inscricao(s1);
    await inscricao(s1);
    await inscricao(s1, "cancelado");
    await presenca(s1, a, "2026-10-20T12:00:00Z", "2026-10-20T12:55:00Z");
    await presenca(s1, b, "2026-10-20T12:00:00Z", "2026-10-20T12:20:00Z");
    await presenca(s1, b, "2026-10-20T12:10:00Z", "2026-10-20T12:30:00Z");
    await db.query("select somar_atividade($1, $2, 35, 35, 5)", [a, s1]);
    for (let k = 0; k < 3; k++) await db.query("select somar_atividade($1, $2, 35, 0, 0)", [a, s1]);
    await db.query("update atividade_lead set cam_s = 1800 where inscricao_id = $1", [a]);
    await db.query("update sessoes set status = 'encerrada' where id = $1", [s1]);
    await venda(a, 1000);
    await venda(a, 500);
    await venda(a, 9999, "reembolsada");
    // Segunda sessão, outro dia, 1 inscrito que veio sem atividade e ficou até o fim (sem saída).
    s2 = await sessao("2026-10-22T12:00:00Z");
    const e = await inscricao(s2);
    await presenca(s2, e, "2026-10-22T11:58:00Z", null);
    // Cancelada: fora de tudo.
    const s3 = await sessao("2026-10-21T12:00:00Z", "cancelada");
    await inscricao(s3);
  });

  it("dashboard_resumo soma o funil do período", async () => {
    await comoLogado(MEMBRO);
    const { rows } = await db.query<Record<string, unknown>>("select * from dashboard_resumo('2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z', null, null)");
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect({ ...r, receita_centavos: Number(r.receita_centavos), minutos_medios: Number(r.minutos_medios), nota_media: Number(r.nota_media) }).toEqual({
      inscritos: 3,
      vieram: 2,
      ficaram_ate_fim: 1,
      interagiram: 1,
      compraram: 1,
      receita_centavos: 1500,
      minutos_medios: 42.5,
      nota_media: 58.5, // (97 + 20) / 2
    });
    await db.exec("reset role");
  });

  it("nota de A no banco é a mesma do JS", async () => {
    const { rows } = await db.query<{ nota: number; minutos: number }>("select nota, minutos from dashboard_linhas(null, null, null, null) where inscricao_id = $1", [a]);
    expect(rows).toEqual([{ nota: notaInteracao({ minutos: 55, duracaoMin: 60, msgs: 5, micS: 140, camS: 1800 }), minutos: 55 }]);
    expect(rows[0].nota).toBe(97);
  });

  it("presença antes do início conta a partir do início", async () => {
    const s = await sessao("2026-10-18T12:00:00Z");
    const cedo = await inscricao(s);
    await presenca(s, cedo, "2026-10-18T11:45:00Z", "2026-10-18T12:33:00Z");
    const { rows } = await db.query<{ minutos: number }>("select minutos from dashboard_linhas(null, null, null, $1)", [s]);
    expect(rows).toEqual([{ minutos: 33 }]);
    await comoLogado(MEMBRO);
    const r = (await db.query<{ vieram: number; ficaram_ate_fim: number }>("select * from dashboard_resumo(null, null, null, $1)", [s])).rows[0];
    expect(r).toMatchObject({ vieram: 1, ficaram_ate_fim: 0 });
    const ret = (await db.query<{ minuto: number; presentes: number }>("select * from dashboard_retencao($1)", [s])).rows;
    expect(ret[0]).toEqual({ minuto: 0, presentes: 1 });
    expect(ret.find((x) => x.minuto === 33)?.presentes).toBe(0);
    await db.exec("reset role");
  });

  it("sessão avaliada: minutos pela presença cortada, não pelo minutos_na_sala inflado", async () => {
    const s = await sessao("2026-10-16T12:00:00Z");
    const cedo = await inscricao(s, "compareceu", 48); // avaliação contou 15 min antes do início
    await presenca(s, cedo, "2026-10-16T11:45:00Z", "2026-10-16T12:33:00Z");
    const manual = await inscricao(s, "compareceu", 20); // marcado à mão, sem presença
    const { rows } = await db.query<{ inscricao_id: string; minutos: number }>(
      "select inscricao_id, minutos from dashboard_linhas(null, null, null, $1)",
      [s],
    );
    expect(rows.find((r) => r.inscricao_id === cedo)?.minutos).toBe(33);
    expect(rows.find((r) => r.inscricao_id === manual)?.minutos).toBe(20);
  });

  it("retenção ignora presença de inscrição cancelada", async () => {
    const s = await sessao("2026-10-17T12:00:00Z");
    const ok = await inscricao(s);
    const cancelada = await inscricao(s, "cancelado");
    await presenca(s, ok, "2026-10-17T12:00:00Z", "2026-10-17T12:10:00Z");
    await presenca(s, cancelada, "2026-10-17T12:00:00Z", "2026-10-17T12:10:00Z");
    await comoLogado(MEMBRO);
    const ret = (await db.query<{ minuto: number; presentes: number }>("select * from dashboard_retencao($1)", [s])).rows;
    expect(ret.find((x) => x.minuto === 5)?.presentes).toBe(1);
    await db.exec("reset role");
  });

  it("sem filtro de período pega as duas sessões; filtro por sessão e por agenda", async () => {
    await comoLogado(MEMBRO);
    const todos = (await db.query<{ inscritos: number; vieram: number; ficaram_ate_fim: number }>("select * from dashboard_resumo(null, null, null, null)")).rows[0];
    expect(todos).toMatchObject({ inscritos: 4, vieram: 3, ficaram_ate_fim: 2 });
    const soS2 = (await db.query<{ inscritos: number }>("select * from dashboard_resumo(null, null, null, $1)", [s2])).rows[0];
    expect(soS2.inscritos).toBe(1);
    const outra = (await db.query<{ inscritos: number }>("select * from dashboard_resumo(null, null, gen_random_uuid(), null)")).rows[0];
    expect(outra).toMatchObject({ inscritos: 0, vieram: 0, compraram: 0 });
    await db.exec("reset role");
  });

  it("dashboard_sessoes lista por início desc, sem a cancelada", async () => {
    await comoLogado(MEMBRO);
    const { rows } = await db.query<Record<string, unknown>>("select * from dashboard_sessoes(null, null, null, null)");
    expect(rows.map((r) => r.id)).toEqual([s2, s1]);
    const r1 = rows[1];
    expect({ ...r1, inicio: undefined, receita_centavos: Number(r1.receita_centavos), minutos_medios: Number(r1.minutos_medios), nota_media: Number(r1.nota_media) }).toEqual({
      id: s1,
      inicio: undefined,
      agenda: "Vendas",
      titulo: "Call",
      inscritos: 3,
      vieram: 2,
      minutos_medios: 42.5,
      nota_media: 58.5,
      compraram: 1,
      receita_centavos: 1500,
      anfitriao: null,
    });
    await db.exec("reset role");
  });

  it("dashboard_sessoes mostra sessão sem inscritos com zeros", async () => {
    const vazia = await sessao("2026-10-23T12:00:00Z");
    await comoLogado(MEMBRO);
    const { rows } = await db.query<Record<string, unknown>>("select * from dashboard_sessoes(null, null, null, $1)", [vazia]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inscritos: 0, vieram: 0, compraram: 0 });
    expect(Number(rows[0].receita_centavos)).toBe(0);
    await db.exec("reset role");
  });

  it("dashboard_retencao conta quem estava em cada minuto", async () => {
    await comoLogado(MEMBRO);
    const { rows } = await db.query<{ minuto: number; presentes: number }>("select * from dashboard_retencao($1)", [s1]);
    expect(rows).toHaveLength(91); // 0..60+30
    const em = (m: number) => rows.find((r) => r.minuto === m)?.presentes;
    expect(em(0)).toBe(2);
    expect(em(25)).toBe(2);
    expect(em(30)).toBe(1); // B saiu 12:30
    expect(em(54)).toBe(1);
    expect(em(55)).toBe(0);
    expect(em(90)).toBe(0);
    const r2 = (await db.query<{ minuto: number; presentes: number }>("select * from dashboard_retencao($1)", [s2])).rows;
    expect(r2.every((r) => r.presentes === 1)).toBe(true); // sem saída = até o fim da janela
    await db.exec("reset role");
  });

  it("quem não é da equipe não usa o dashboard", async () => {
    await comoLogado(ESTRANHO);
    await expect(db.query("select * from dashboard_resumo(null, null, null, null)")).rejects.toThrow();
    await db.exec("reset role");
    await comoLogado(ESTRANHO);
    await expect(db.query("select * from dashboard_sessoes(null, null, null, null)")).rejects.toThrow();
    await db.exec("reset role");
    await comoLogado(ESTRANHO);
    await expect(db.query("select * from dashboard_retencao($1)", [s1])).rejects.toThrow();
    await db.exec("reset role");
    await db.exec("set role anon");
    await expect(db.query("select * from dashboard_resumo(null, null, null, null)")).rejects.toThrow();
    await db.exec("reset role");
    await comoLogado(MEMBRO);
    await expect(db.query("select * from dashboard_linhas(null, null, null, null)")).rejects.toThrow();
    await db.exec("reset role");
  });
});

describe("contar_dependencias", () => {
  it("conta o que vai junto de agenda, sessão, reunião e gravação", async () => {
    const s = await sessao("2026-10-20T12:00:00Z");
    const s2 = await sessao("2026-10-21T12:00:00Z");
    const i = await inscricao(s);
    await inscricao(s);
    await inscricao(s2);
    await db.query("insert into gravacoes (sessao_id, rtk_recording_id, status) values ($1, 'g1', 'UPLOADED'), ($1, 'g2', 'UPLOADED')", [s]);
    await db.query(
      "insert into eventos (id_evento, evento, inscricao_id, sessao_id, agenda_id, corpo) values ('e1', 'agendou', $1, $2, $3, '{}'), ('e2', 'compareceu', $1, $2, $3, '{}')",
      [i, s, agenda],
    );
    await venda(i, 100);
    const { rows: [r] } = await db.query<{ id: string }>("insert into reunioes (codigo, expira_em) values ('abcdefghij', now()) returning id");
    const { rows: [g] } = await db.query<{ id: string }>("insert into gravacoes (reuniao_id, rtk_recording_id, status) values ($1, 'g3', 'UPLOADED') returning id", [r.id]);

    await comoLogado(MEMBRO);
    const conta = async (tipo: string, id: string) =>
      (await db.query<{ c: Record<string, number> }>("select contar_dependencias($1, $2) as c", [tipo, id])).rows[0].c;
    expect(await conta("agenda", agenda)).toEqual({ sessoes: 2, inscritos: 3, gravacoes: 2, avisos: 2, vendas: 1 });
    expect(await conta("sessao", s)).toEqual({ sessoes: 0, inscritos: 2, gravacoes: 2, avisos: 2, vendas: 1 });
    expect(await conta("sessao", s2)).toEqual({ sessoes: 0, inscritos: 1, gravacoes: 0, avisos: 0, vendas: 0 });
    expect(await conta("reuniao", r.id)).toEqual({ sessoes: 0, inscritos: 0, gravacoes: 1, avisos: 0, vendas: 0 });
    expect(await conta("gravacao", g.id)).toEqual({ sessoes: 0, inscritos: 0, gravacoes: 1, avisos: 0, vendas: 0 });
    await expect(conta("outra", agenda)).rejects.toThrow();
    await db.exec("reset role");

    await comoLogado(ESTRANHO);
    await expect(conta("agenda", agenda)).rejects.toThrow();
    await db.exec("reset role");

    await db.query("select set_config('app.uid', '', false)");
    await db.exec("set role service_role");
    expect(await conta("sessao", s)).toMatchObject({ inscritos: 2 });
    await db.exec("reset role");

    await db.exec("set role anon");
    await expect(conta("sessao", s)).rejects.toThrow();
    await db.exec("reset role");
  });
});

describe("painel da sessão (TS) x dashboard_linhas (SQL)", () => {
  it("minutosDoLead dá os mesmos minutos por lead que o banco", async () => {
    const inicio = "2026-10-01T22:00:00Z";
    const s = await sessao(inicio);
    const casos: { entrou_em: string; saiu_em: string | null }[][] = [
      [],
      [{ entrou_em: "2026-10-01T21:40:00Z", saiu_em: "2026-10-01T22:25:30Z" }],
      [
        { entrou_em: "2026-10-01T22:05:00Z", saiu_em: "2026-10-01T22:20:00Z" },
        { entrou_em: "2026-10-01T22:15:00Z", saiu_em: "2026-10-01T22:40:00Z" },
        { entrou_em: "2026-10-01T23:30:00Z", saiu_em: null },
      ],
      [{ entrou_em: "2026-10-02T01:30:00Z", saiu_em: null }],
      [{ entrou_em: "2026-10-01T21:00:00Z", saiu_em: "2026-10-01T21:30:00Z" }],
    ];
    const ids: string[] = [];
    for (const c of casos) {
      const id = await inscricao(s, "agendado", 9);
      ids.push(id);
      for (const p of c) await presenca(s, id, p.entrou_em, p.saiu_em);
    }
    const { rows } = await db.query<{ inscricao_id: string; minutos: number }>("select inscricao_id, minutos from dashboard_linhas(null, null, null, $1)", [s]);
    const doBanco = new Map(rows.map((r) => [r.inscricao_id, r.minutos]));
    casos.forEach((c, i) => {
      const ts = minutosDoLead({ presencas: c, inicio: new Date(inicio), duracaoMin: 60, agora: new Date(), minutosNaSala: 9 });
      expect(ts, `caso ${i}`).toBe(doBanco.get(ids[i]));
    });
  });
});
