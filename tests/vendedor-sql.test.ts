import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

// Gabriel é admin; Hugo é o vendedor da agenda "Implementação"; Olavo é membro e vendedor da agenda "Vendas".
const GABRIEL = "11111111-1111-4111-8111-111111111111";
const HUGO = "22222222-2222-4222-8222-222222222222";
const OLAVO = "33333333-3333-4333-8333-333333333333";
const SEM_AGENDA = "44444444-4444-4444-8444-444444444444";

let db: PGlite;
let ids: Record<string, string>;
let seq = 0;

async function comoLogado(uid: string) {
  await db.query("select set_config('app.uid', $1, false)", [uid]);
  await db.exec("set role authenticated");
}
async function comoServidor() {
  await db.exec("reset role");
  await db.query("select set_config('app.uid', '', false)");
}
async function um<T = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, p)).rows[0];
}
async function contar(tabela: string): Promise<number> {
  return (await um<{ n: number }>(`select count(*)::int as n from ${tabela}`)).n;
}

async function sessao(agenda: string): Promise<string> {
  return (await um<{ id: string }>("insert into sessoes (agenda_id, inicio, vagas, status) values ($1, now() - interval '1 hour', 30, 'encerrada') returning id", [agenda])).id;
}
async function inscricao(sessaoId: string, agenda: string, whatsapp: string): Promise<string> {
  seq++;
  return (
    await um<{ id: string }>(
      "insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp, status) values ($1, $2, $3, 'Lead', $4, 'compareceu') returning id",
      [sessaoId, agenda, `v${String(seq).padStart(9, "0")}`, whatsapp],
    )
  ).id;
}

beforeEach(async () => {
  db = await bancoComMigracoes({ privilegiosSupabase: true });
  await db.query(
    "insert into auth.users (id, email) values ($1, 'g@x.com'), ($2, 'h@x.com'), ($3, 'o@x.com'), ($4, 's@x.com')",
    [GABRIEL, HUGO, OLAVO, SEM_AGENDA],
  );
  const u = async (auth: string, nome: string, papel: string) =>
    (await um<{ id: string }>("insert into usuarios (auth_id, nome, email, papel) values ($1, $2, $3, $4) returning id", [auth, nome, `${nome}@x.com`, papel])).id;
  ids = {
    gabriel: await u(GABRIEL, "Gabriel", "admin"),
    hugo: await u(HUGO, "Hugo", "membro"),
    olavo: await u(OLAVO, "Olavo", "membro"),
    semAgenda: await u(SEM_AGENDA, "Sem Agenda", "membro"),
  };
  ids.agImpl = (await um<{ id: string }>("insert into agendas (nome, slug, responsavel_id) values ('Implementação', 'impl', $1) returning id", [ids.hugo])).id;
  ids.agVendas = (await um<{ id: string }>("insert into agendas (nome, slug, responsavel_id) values ('Vendas', 'vendas', $1) returning id", [ids.olavo])).id;
  await db.query("insert into repeticoes (agenda_id, dias_semana, hora, vagas) values ($1, '{1}', '09:00', 30), ($2, '{2}', '10:00', 30)", [ids.agImpl, ids.agVendas]);
  ids.sImpl = await sessao(ids.agImpl);
  ids.sVendas = await sessao(ids.agVendas);
  ids.iImpl = await inscricao(ids.sImpl, ids.agImpl, "+551130000001");
  ids.iVendas = await inscricao(ids.sVendas, ids.agVendas, "+551130000002");
  await db.query("insert into fichas (whatsapp, observacoes) values ('+551130000001', 'impl'), ('+551130000002', 'vendas')");
  await db.query("insert into presencas (sessao_id, inscricao_id, peer_id, entrou_em) values ($1, $2, 'p1', now()), ($3, $4, 'p2', now())", [ids.sImpl, ids.iImpl, ids.sVendas, ids.iVendas]);
  await db.query(
    "insert into eventos (id_evento, evento, inscricao_id, sessao_id, agenda_id, corpo) values ('e1', 'agendou', $1, $2, $3, '{}'), ('e2', 'agendou', $4, $5, $6, '{}')",
    [ids.iImpl, ids.sImpl, ids.agImpl, ids.iVendas, ids.sVendas, ids.agVendas],
  );
  await db.query("insert into atividade_lead (inscricao_id, sessao_id) values ($1, $2), ($3, $4)", [ids.iImpl, ids.sImpl, ids.iVendas, ids.sVendas]);
  await db.query(
    "insert into vendas (order_id, status, inscricao_id, sessao_id) values ('o1', 'aprovada', $1, $2), ('o2', 'aprovada', $3, $4), ('o3', 'aprovada', null, null)",
    [ids.iImpl, ids.sImpl, ids.iVendas, ids.sVendas],
  );
  ids.reuniao = (await um<{ id: string }>("insert into reunioes (codigo, expira_em) values ('abcdefghij', now() + interval '1 day') returning id")).id;
  await db.query("insert into gravacoes (sessao_id, rtk_recording_id, status) values ($1, 'g1', 'UPLOADED'), ($2, 'g2', 'UPLOADED')", [ids.sImpl, ids.sVendas]);
  await db.query("insert into gravacoes (reuniao_id, rtk_recording_id, status) values ($1, 'g3', 'UPLOADED')", [ids.reuniao]);
});

const TABELAS = ["agendas", "repeticoes", "sessoes", "inscricoes", "fichas", "presencas", "eventos", "atividade_lead"];

describe("colunas novas", () => {
  it("usuarios.whatsapp só em E.164; anfitrião e responsável ficam nulos quando o usuário some", async () => {
    await expect(db.query("update usuarios set whatsapp = '1139990000' where id = $1", [ids.hugo])).rejects.toThrow();
    await db.query("update usuarios set whatsapp = '+551139990000' where id = $1", [ids.hugo]);
    await db.query("update sessoes set anfitriao_id = $1, anfitriao_entrou_em = now() where id = $2", [ids.hugo, ids.sImpl]);
    await db.query("delete from usuarios where id = $1", [ids.hugo]);
    expect(await um("select responsavel_id from agendas where id = $1", [ids.agImpl])).toEqual({ responsavel_id: null });
    expect(await um("select anfitriao_id from sessoes where id = $1", [ids.sImpl])).toEqual({ anfitriao_id: null });
  });
});

describe("recorte por agenda (RLS)", () => {
  it("admin vê tudo", async () => {
    await comoLogado(GABRIEL);
    for (const t of TABELAS) expect(await contar(t), t).toBe(2);
    expect(await contar("vendas")).toBe(3);
    expect(await contar("gravacoes")).toBe(3);
    await comoServidor();
  });

  it("o vendedor vê só a agenda dele (e as gravações de reunião, como antes)", async () => {
    await comoLogado(HUGO);
    for (const t of TABELAS) expect(await contar(t), t).toBe(1);
    expect(await um("select id from agendas")).toEqual({ id: ids.agImpl });
    expect(await um("select id from sessoes")).toEqual({ id: ids.sImpl });
    expect(await um("select whatsapp from fichas")).toEqual({ whatsapp: "+551130000001" });
    expect(await contar("vendas")).toBe(1);
    expect((await db.query("select reuniao_id from gravacoes order by reuniao_id nulls first")).rows).toEqual([{ reuniao_id: null }, { reuniao_id: ids.reuniao }]);
    expect(await contar("reunioes")).toBe(1);
    expect(await contar("usuarios")).toBe(4);
    await comoServidor();
  });

  it("membro sem agenda não vê nenhum dado de agenda", async () => {
    await comoLogado(SEM_AGENDA);
    for (const t of TABELAS) expect(await contar(t), t).toBe(0);
    expect(await contar("vendas")).toBe(0);
    expect(await contar("gravacoes")).toBe(1); // só a da reunião
    await comoServidor();
  });

  it("o vendedor não altera sessão, inscrição nem ficha de outra agenda", async () => {
    await comoLogado(HUGO);
    await db.query("update sessoes set status = 'cancelada' where id = $1", [ids.sVendas]);
    await db.query("update inscricoes set status = 'faltou' where id = $1", [ids.iVendas]);
    await db.query("update fichas set observacoes = 'x' where whatsapp = '+551130000002'");
    await expect(db.query("insert into fichas (whatsapp) values ('+551130000009')")).rejects.toThrow();
    await db.query("update sessoes set status = 'ao_vivo' where id = $1", [ids.sImpl]);
    await db.query("update inscricoes set status = 'faltou' where id = $1", [ids.iImpl]);
    await db.query("update fichas set observacoes = 'minha' where whatsapp = '+551130000001'");
    await comoServidor();
    expect(await um("select status from sessoes where id = $1", [ids.sVendas])).toEqual({ status: "encerrada" });
    expect(await um("select status from inscricoes where id = $1", [ids.iVendas])).toEqual({ status: "compareceu" });
    expect(await um("select observacoes from fichas where whatsapp = '+551130000002'")).toEqual({ observacoes: "vendas" });
    expect(await um("select status from sessoes where id = $1", [ids.sImpl])).toEqual({ status: "ao_vivo" });
    expect(await um("select status from inscricoes where id = $1", [ids.iImpl])).toEqual({ status: "faltou" });
    expect(await um("select observacoes from fichas where whatsapp = '+551130000001'")).toEqual({ observacoes: "minha" });
  });

  it("a equipe só muda o status: nem WhatsApp, nem sessão da inscrição, nem outras colunas da sessão", async () => {
    await comoLogado(HUGO);
    // Trocar o WhatsApp pra ler a ficha de outro lead, ou mover a inscrição pra sessão de outra agenda: negado.
    await expect(db.query("update inscricoes set whatsapp = '+551130000002' where id = $1", [ids.iImpl])).rejects.toThrow();
    await comoServidor();
    await comoLogado(HUGO);
    await expect(db.query("update inscricoes set sessao_id = $1 where id = $2", [ids.sVendas, ids.iImpl])).rejects.toThrow();
    await comoServidor();
    await comoLogado(HUGO);
    await expect(db.query("update sessoes set titulo = 'x' where id = $1", [ids.sImpl])).rejects.toThrow();
    await comoServidor();
    await comoLogado(GABRIEL);
    await expect(db.query("update inscricoes set whatsapp = '+551130000002' where id = $1", [ids.iImpl])).rejects.toThrow();
    await comoServidor();
    expect(await um("select whatsapp, sessao_id from inscricoes where id = $1", [ids.iImpl])).toEqual({ whatsapp: "+551130000001", sessao_id: ids.sImpl });
    expect(await um("select count(*)::int as n from fichas where whatsapp = '+551130000002'")).toEqual({ n: 1 });
  });

  it("ninguém da equipe lê o segredo do CRM da agenda; o resto da agenda sim", async () => {
    await db.query("update agendas set crm_segredo = 's3gr3d0', crm_urls = '{\"agendou\": \"https://crm.test\"}' where id = $1", [ids.agImpl]);
    for (const quem of [HUGO, GABRIEL]) {
      await comoLogado(quem);
      expect(await um("select nome, crm_urls, responsavel_id from agendas where id = $1", [ids.agImpl])).toMatchObject({ nome: "Implementação" });
      await expect(db.query("select crm_segredo from agendas")).rejects.toThrow();
      await comoServidor();
      await comoLogado(quem);
      await expect(db.query("select * from agendas")).rejects.toThrow();
      await comoServidor();
    }
    // O admin continua gravando o segredo (editor da agenda) sem precisar ler.
    await comoLogado(GABRIEL);
    await db.query("update agendas set crm_segredo = 'novo' where id = $1", [ids.agImpl]);
    await comoServidor();
    expect(await um("select crm_segredo from agendas where id = $1", [ids.agImpl])).toEqual({ crm_segredo: "novo" });
  });

  it("o vendedor não troca o responsável da própria agenda", async () => {
    await comoLogado(HUGO);
    await expect(db.query("update agendas set responsavel_id = null where id = $1", [ids.agImpl])).resolves.toBeDefined();
    await comoServidor();
    expect(await um("select responsavel_id from agendas where id = $1", [ids.agImpl])).toEqual({ responsavel_id: ids.hugo });
  });

  it("pode_ver_agenda e pode_ver_sessao", async () => {
    await comoLogado(HUGO);
    expect(await um("select pode_ver_agenda($1) as a, pode_ver_agenda($2) as b", [ids.agImpl, ids.agVendas])).toEqual({ a: true, b: false });
    expect(await um("select pode_ver_sessao($1) as a, pode_ver_sessao($2) as b", [ids.sImpl, ids.sVendas])).toEqual({ a: true, b: false });
    expect(await um("select meu_usuario_id() as id")).toEqual({ id: ids.hugo });
    await comoServidor();
    await comoLogado(GABRIEL);
    expect(await um("select pode_ver_agenda($1) as a, pode_ver_sessao($2) as b", [ids.agVendas, ids.sVendas])).toEqual({ a: true, b: true });
    await comoServidor();
  });

  it("a equipe lê a marca, mas não o segredo dos avisos da equipe", async () => {
    await db.query("update configuracao set crm_url_equipe = 'https://crm.test/equipe', crm_segredo_equipe = 's3gr3d0'");
    await comoLogado(HUGO);
    expect(await um("select nome, crm_url_equipe from configuracao")).toEqual({ nome: "Sua Empresa", crm_url_equipe: "https://crm.test/equipe" });
    await expect(db.query("select crm_segredo_equipe from configuracao")).rejects.toThrow();
    await comoServidor();
    await comoLogado(GABRIEL);
    await expect(db.query("select crm_segredo_equipe from configuracao")).rejects.toThrow();
    await comoServidor();
  });
});

describe("contar_dependencias", () => {
  it("membro só conta a agenda e a sessão dele", async () => {
    await comoLogado(HUGO);
    expect(await um("select contar_dependencias('agenda', $1) as c", [ids.agImpl])).toMatchObject({ c: { sessoes: 1 } });
    expect(await um("select contar_dependencias('sessao', $1) as c", [ids.sImpl])).toMatchObject({ c: { inscritos: 1 } });
    await expect(db.query("select contar_dependencias('agenda', $1)", [ids.agVendas])).rejects.toThrow();
    await comoServidor();
    await comoLogado(HUGO);
    await expect(db.query("select contar_dependencias('sessao', $1)", [ids.sVendas])).rejects.toThrow();
    await comoServidor();
  });
});

describe("marcar_anfitriao", () => {
  it("grava só o primeiro anfitrião e nunca sobrescreve", async () => {
    expect(await um("select marcar_anfitriao($1, $2) as ok", [ids.sImpl, ids.hugo])).toEqual({ ok: true });
    const primeiro = await um<{ anfitriao_id: string; anfitriao_entrou_em: string }>("select anfitriao_id, anfitriao_entrou_em from sessoes where id = $1", [ids.sImpl]);
    expect(primeiro.anfitriao_id).toBe(ids.hugo);
    expect(primeiro.anfitriao_entrou_em).not.toBeNull();
    expect(await um("select marcar_anfitriao($1, $2) as ok", [ids.sImpl, ids.gabriel])).toEqual({ ok: false });
    expect(await um("select anfitriao_id, anfitriao_entrou_em from sessoes where id = $1", [ids.sImpl])).toEqual(primeiro);
  });

  it("a equipe, pelo REST, não grava, não troca e não limpa o anfitrião", async () => {
    await comoLogado(HUGO);
    await expect(db.query("update sessoes set anfitriao_id = $1, anfitriao_entrou_em = now() where id = $2", [ids.hugo, ids.sImpl])).rejects.toThrow();
    await comoServidor();
    await db.query("select marcar_anfitriao($1, $2)", [ids.sImpl, ids.gabriel]);
    for (const quem of [HUGO, GABRIEL]) {
      await comoLogado(quem);
      await expect(db.query("update sessoes set anfitriao_id = null where id = $1", [ids.sImpl])).rejects.toThrow();
      await comoServidor();
    }
    expect(await um("select anfitriao_id from sessoes where id = $1", [ids.sImpl])).toEqual({ anfitriao_id: ids.gabriel });
  });

  it("trigger: membro logado não muda o anfitrião nem com permissão de coluna (defesa extra)", async () => {
    await db.query("select marcar_anfitriao($1, $2)", [ids.sImpl, ids.gabriel]);
    await db.exec("grant update (anfitriao_id) on sessoes to authenticated");
    await comoLogado(HUGO);
    await db.query("update sessoes set anfitriao_id = null where id = $1", [ids.sImpl]);
    await comoServidor();
    expect(await um("select anfitriao_id from sessoes where id = $1", [ids.sImpl])).toEqual({ anfitriao_id: ids.gabriel });
  });

  it("só o servidor chama", async () => {
    await comoLogado(GABRIEL);
    await expect(db.query("select marcar_anfitriao($1, $2)", [ids.sImpl, ids.gabriel])).rejects.toThrow();
    await comoServidor();
  });
});

describe("avisos_equipe (fila)", () => {
  const enfileirar = (id: string, semDestino = false) =>
    um<{ ok: boolean }>("select enfileirar_aviso_equipe($1, 'vendedor_sessao_em_breve', $2, $3, $4, '{}'::jsonb, $5) as ok", [
      id, ids.hugo, ids.sImpl, ids.agImpl, semDestino,
    ]);

  it("não duplica pelo id_evento e o status nasce pelo destino", async () => {
    expect(await enfileirar("a1")).toEqual({ ok: true });
    expect(await enfileirar("a1")).toEqual({ ok: false });
    expect(await enfileirar("a2", true)).toEqual({ ok: true });
    expect((await db.query("select id_evento, status from avisos_equipe order by id_evento")).rows).toEqual([
      { id_evento: "a1", status: "pendente" },
      { id_evento: "a2", status: "sem_destino" },
    ]);
  });

  it("reivindica só os pendentes vencidos e empurra a próxima tentativa", async () => {
    await enfileirar("a1");
    await enfileirar("a2", true);
    const r = (await db.query<{ id_evento: string }>("select id_evento from reivindicar_avisos_equipe(10, now() + interval '1 second')")).rows;
    expect(r.map((x) => x.id_evento)).toEqual(["a1"]);
    expect((await db.query("select * from reivindicar_avisos_equipe(10, now() + interval '1 second')")).rows).toEqual([]);
  });

  it("equipe só lê (admin) e não chama as funções", async () => {
    await enfileirar("a1");
    await comoLogado(HUGO);
    expect(await contar("avisos_equipe")).toBe(0);
    await expect(enfileirar("a3")).rejects.toThrow();
    await comoServidor();
    await comoLogado(GABRIEL);
    expect(await contar("avisos_equipe")).toBe(1);
    await comoServidor();
  });
});
