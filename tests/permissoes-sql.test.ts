import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

// Permissões por membro (20261024120000_permissoes.sql). Gabriel é admin; Hugo é o vendedor da agenda
// "Implementação"; Olavo, da agenda "Vendas".
const GABRIEL = "11111111-1111-4111-8111-111111111111";
const HUGO = "22222222-2222-4222-8222-222222222222";
const OLAVO = "33333333-3333-4333-8333-333333333333";

let db: PGlite;
let ids: Record<string, string>;

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
async function permissoes(usuario: string, p: Record<string, boolean>) {
  await comoServidor();
  await db.query("update usuarios set permissoes = permissoes || $1::jsonb where id = $2", [JSON.stringify(p), usuario]);
}
/** Roda como a pessoa e volta pro servidor (erro de SQL aborta só esta chamada). */
async function como<T>(uid: string, f: () => Promise<T>): Promise<T> {
  await comoLogado(uid);
  try {
    return await f();
  } finally {
    await comoServidor();
  }
}

beforeEach(async () => {
  db = await bancoComMigracoes({ privilegiosSupabase: true });
  await db.query("insert into auth.users (id, email) values ($1, 'g@x.com'), ($2, 'h@x.com'), ($3, 'o@x.com')", [GABRIEL, HUGO, OLAVO]);
  const u = async (auth: string, nome: string, papel: string) =>
    (await um<{ id: string }>("insert into usuarios (auth_id, nome, email, papel) values ($1, $2, $3, $4) returning id", [auth, nome, `${nome}@x.com`, papel])).id;
  ids = { gabriel: await u(GABRIEL, "Gabriel", "admin"), hugo: await u(HUGO, "Hugo", "membro"), olavo: await u(OLAVO, "Olavo", "membro") };
  ids.agImpl = (await um<{ id: string }>("insert into agendas (nome, slug, responsavel_id) values ('Implementação', 'impl', $1) returning id", [ids.hugo])).id;
  ids.agVendas = (await um<{ id: string }>("insert into agendas (nome, slug, responsavel_id) values ('Vendas', 'vendas', $1) returning id", [ids.olavo])).id;
  const sessao = async (agenda: string, status = "encerrada") =>
    (await um<{ id: string }>("insert into sessoes (agenda_id, inicio, vagas, status) values ($1, now() - interval '1 hour', 30, $2) returning id", [agenda, status])).id;
  ids.sImpl = await sessao(ids.agImpl);
  ids.sVendas = await sessao(ids.agVendas);
  ids.sVendasAgendada = await sessao(ids.agVendas, "agendada");
  ids.sImplAgendada = await sessao(ids.agImpl, "agendada");
  const inscricao = async (s: string, a: string, codigo: string, wa: string) =>
    (await um<{ id: string }>(
      "insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp, email, status) values ($1, $2, $3, 'Lead', $4, 'lead@x.com', 'compareceu') returning id",
      [s, a, codigo, wa],
    )).id;
  ids.iImpl = await inscricao(ids.sImpl, ids.agImpl, "aaaaaaaaa1", "+551130000001");
  ids.iVendas = await inscricao(ids.sVendas, ids.agVendas, "aaaaaaaaa2", "+551130000002");
  await db.query("insert into fichas (whatsapp, observacoes) values ('+551130000001', 'impl'), ('+551130000002', 'vendas')");
  await db.query("insert into presencas (sessao_id, inscricao_id, peer_id, entrou_em) values ($1, $2, 'p1', now() - interval '50 minutes'), ($3, $4, 'p2', now() - interval '50 minutes')", [ids.sImpl, ids.iImpl, ids.sVendas, ids.iVendas]);
  await db.query(
    "insert into vendas (order_id, status, valor_centavos, email, whatsapp, inscricao_id, sessao_id) values ('o1', 'aprovada', 1000, 'lead@x.com', '+551130000001', $1, $2), ('o2', 'aprovada', 2000, 'lead@x.com', '+551130000002', $3, $4)",
    [ids.iImpl, ids.sImpl, ids.iVendas, ids.sVendas],
  );
  await db.query(
    "insert into eventos (id_evento, evento, inscricao_id, sessao_id, agenda_id, corpo) values ('e1', 'agendou', $1, $2, $3, '{\"whatsapp\":\"+551130000001\"}')",
    [ids.iImpl, ids.sImpl, ids.agImpl],
  );
  await db.query("insert into gravacoes (sessao_id, rtk_recording_id, status) values ($1, 'g1', 'UPLOADED'), ($2, 'g2', 'UPLOADED')", [ids.sImpl, ids.sVendas]);
});

describe("usuarios.permissoes", () => {
  it("quem existe e quem entra nasce com o padrão (todas_agendas desligada, o resto ligado)", async () => {
    const { permissoes: p } = await um<{ permissoes: Record<string, boolean> }>("select permissoes from usuarios where id = $1", [ids.hugo]);
    expect(p).toEqual({
      dashboard: true, receita: true, anfitriao: true, espiao: true, ficha: true, contato_lead: true, horarios: true,
      gravacoes: true, reunioes: true, todas_agendas: false,
    });
  });

  it("só aceita objeto", async () => {
    await expect(db.query("update usuarios set permissoes = '[]' where id = $1", [ids.hugo])).rejects.toThrow();
  });

  it("o membro não muda as próprias permissões; o admin muda", async () => {
    await como(HUGO, () => db.query("update usuarios set permissoes = '{\"todas_agendas\": true}' where id = $1", [ids.hugo]));
    expect(await um("select permissoes->>'todas_agendas' as t from usuarios where id = $1", [ids.hugo])).toEqual({ t: "false" });
    await como(GABRIEL, () => db.query("update usuarios set permissoes = permissoes || '{\"todas_agendas\": true}' where id = $1", [ids.hugo]));
    expect(await um("select permissoes->>'todas_agendas' as t from usuarios where id = $1", [ids.hugo])).toEqual({ t: "true" });
  });
});

describe("tem_permissao", () => {
  it("admin sempre; membro pelo salvo, faltando vale o padrão; chave desconhecida = não; fora da equipe = não", async () => {
    await permissoes(ids.gabriel, { receita: false });
    await permissoes(ids.hugo, { receita: false });
    await comoServidor();
    await db.query("update usuarios set permissoes = permissoes - 'ficha' where id = $1", [ids.hugo]);
    expect(await como(GABRIEL, () => um("select tem_permissao('receita') as r, tem_permissao('todas_agendas') as t"))).toEqual({ r: true, t: true });
    expect(
      await como(HUGO, () => um("select tem_permissao('receita') as r, tem_permissao('ficha') as f, tem_permissao('todas_agendas') as t, tem_permissao('xyz') as x")),
    ).toEqual({ r: false, f: true, t: false, x: false });
    await db.query("update usuarios set ativo = false where id = $1", [ids.olavo]);
    expect(await como(OLAVO, () => um("select tem_permissao('dashboard') as d"))).toEqual({ d: false });
  });
});

describe("todas_agendas", () => {
  it("desligada: o membro vê só a agenda dele (como antes)", async () => {
    await comoLogado(HUGO);
    for (const t of ["agendas", "sessoes", "inscricoes", "presencas", "eventos"]) expect(await contar(t), t).toBe(t === "sessoes" ? 2 : 1);
    await comoServidor();
  });

  it("ligada: lê sessões, inscritos e presenças de todas as agendas, mas não muda nada de outra agenda", async () => {
    await permissoes(ids.hugo, { todas_agendas: true });
    await comoLogado(HUGO);
    expect(await contar("agendas")).toBe(2);
    expect(await contar("sessoes")).toBe(4);
    expect(await contar("inscricoes")).toBe(2);
    expect(await contar("presencas")).toBe(2);
    expect(await um("select pode_ler_sessao($1) as l, pode_ver_sessao($1) as v", [ids.sVendas])).toEqual({ l: true, v: false });
    // Escrever: só na agenda dele (o update de outra agenda não acha linha).
    await db.query("update sessoes set status = 'cancelada' where id = $1", [ids.sVendasAgendada]);
    await db.query("update inscricoes set status = 'faltou' where id = $1", [ids.iVendas]);
    await comoServidor();
    expect(await um("select status from sessoes where id = $1", [ids.sVendasAgendada])).toEqual({ status: "agendada" });
    expect(await um("select status from inscricoes where id = $1", [ids.iVendas])).toEqual({ status: "compareceu" });
    // Ficha e gravação de outra agenda continuam fora.
    expect(await como(HUGO, () => contar("fichas"))).toBe(1);
    expect(await como(HUGO, () => contar("gravacoes"))).toBe(1);
    // Contagem de exclusão segue só na dele.
    await expect(como(HUGO, () => db.query("select contar_dependencias('sessao', $1)", [ids.sVendas]))).rejects.toThrow();
  });
});

describe("contato do lead fora do cliente da equipe", () => {
  it("ninguém da equipe lê whatsapp, email nem respostas da inscrição (nem o admin); o resto sim", async () => {
    for (const quem of [HUGO, GABRIEL]) {
      expect(await como(quem, () => um("select id, nome, status, codigo from inscricoes where id = $1", [ids.iImpl]))).toMatchObject({ nome: "Lead" });
      for (const col of ["whatsapp", "email", "respostas", "*"]) {
        await expect(como(quem, () => db.query(`select ${col} from inscricoes`)), col).rejects.toThrow();
      }
      // Nem filtrando pelo WhatsApp (adivinhar o número).
      await expect(como(quem, () => db.query("select id from inscricoes where whatsapp = '+551130000001'"))).rejects.toThrow();
    }
    // A equipe ainda muda o status (presença manual).
    await como(HUGO, () => db.query("update inscricoes set status = 'faltou' where id = $1", [ids.iImpl]));
    expect(await um("select status from inscricoes where id = $1", [ids.iImpl])).toEqual({ status: "faltou" });
  });

  it("eventos: a equipe lê o status do aviso, não o corpo, a mensagem nem a resposta do CRM", async () => {
    expect(await como(HUGO, () => um("select evento, status from eventos"))).toEqual({ evento: "agendou", status: "pendente" });
    for (const col of ["corpo", "mensagem", "resposta", "*"]) {
      await expect(como(HUGO, () => db.query(`select ${col} from eventos`)), col).rejects.toThrow();
    }
  });

  it("sem contato_lead: fichas e vendas (que têm o contato) somem pro membro", async () => {
    await permissoes(ids.hugo, { contato_lead: false });
    expect(await como(HUGO, () => contar("fichas"))).toBe(0);
    expect(await como(HUGO, () => contar("vendas"))).toBe(0);
    await expect(como(HUGO, () => db.query("insert into fichas (whatsapp) values ('+551130000001')"))).rejects.toThrow();
    await como(HUGO, () => db.query("update fichas set observacoes = 'x'"));
    expect(await um("select observacoes from fichas where whatsapp = '+551130000001'")).toEqual({ observacoes: "impl" });
  });
});

describe("cada permissão desligada no banco", () => {
  it("ficha: some a ficha do lead (leitura e escrita)", async () => {
    await permissoes(ids.hugo, { ficha: false });
    expect(await como(HUGO, () => contar("fichas"))).toBe(0);
    await como(HUGO, () => db.query("update fichas set observacoes = 'x'"));
    expect(await um("select observacoes from fichas where whatsapp = '+551130000001'")).toEqual({ observacoes: "impl" });
  });

  it("gravacoes: some a gravação (até a de reunião)", async () => {
    await db.query("insert into reunioes (codigo, expira_em) values ('abcdefghij', now() + interval '1 day')");
    await db.query("insert into gravacoes (reuniao_id, rtk_recording_id, status) select id, 'g3', 'UPLOADED' from reunioes");
    expect(await como(HUGO, () => contar("gravacoes"))).toBe(2);
    await permissoes(ids.hugo, { gravacoes: false });
    expect(await como(HUGO, () => contar("gravacoes"))).toBe(0);
  });

  it("receita: some a tabela de vendas", async () => {
    expect(await como(HUGO, () => contar("vendas"))).toBe(1);
    await permissoes(ids.hugo, { receita: false });
    expect(await como(HUGO, () => contar("vendas"))).toBe(0);
  });

  it("horarios: o membro não cancela sessão vazia pelo cliente dele", async () => {
    await permissoes(ids.hugo, { horarios: false });
    await expect(como(HUGO, () => db.query("update sessoes set status = 'cancelada' where id = $1", [ids.sImplAgendada]))).rejects.toThrow();
    await permissoes(ids.hugo, { horarios: true });
    await como(HUGO, () => db.query("update sessoes set status = 'cancelada' where id = $1", [ids.sImplAgendada]));
    expect(await um("select status from sessoes where id = $1", [ids.sImplAgendada])).toEqual({ status: "cancelada" });
  });

  it("admin com tudo desligado no jsonb continua vendo tudo", async () => {
    await permissoes(ids.gabriel, { dashboard: false, receita: false, ficha: false, contato_lead: false, gravacoes: false });
    await comoLogado(GABRIEL);
    expect(await contar("fichas")).toBe(2);
    expect(await contar("vendas")).toBe(2);
    expect(await contar("gravacoes")).toBe(2);
    expect((await um<{ r: number }>("select receita_centavos::int as r from dashboard_resumo(null, null, null, null)")).r).toBe(3000);
    await comoServidor();
  });
});

describe("dashboard", () => {
  const resumo = "select inscritos, compraram, receita_centavos::int as receita from dashboard_resumo(null, null, null, null)";

  it("padrão: o membro vê os números e a receita da agenda dele", async () => {
    expect(await como(HUGO, () => um(resumo))).toEqual({ inscritos: 1, compraram: 1, receita: 1000 });
  });

  it("sem dashboard: todas as funções recusam", async () => {
    await permissoes(ids.hugo, { dashboard: false });
    for (const sql of [
      resumo,
      "select * from dashboard_sessoes(null, null, null, null)",
      "select * from dashboard_vendedores(null, null, null, null)",
      `select * from dashboard_retencao('${ids.sImpl}')`,
    ]) {
      await expect(como(HUGO, () => db.query(sql)), sql).rejects.toThrow();
    }
  });

  it("sem receita: compraram e receita voltam nulos (o resto igual)", async () => {
    await permissoes(ids.hugo, { receita: false });
    expect(await como(HUGO, () => um(resumo))).toEqual({ inscritos: 1, compraram: null, receita: null });
    expect(await como(HUGO, () => um("select inscritos, compraram, receita_centavos from dashboard_sessoes(null, null, null, null) where id = $1", [ids.sImpl]))).toEqual({
      inscritos: 1, compraram: null, receita_centavos: null,
    });
    expect(await como(HUGO, () => um("select inscritos, compraram, receita_centavos from dashboard_vendedores(null, null, null, null)"))).toEqual({
      inscritos: 1, compraram: null, receita_centavos: null,
    });
  });

  it("todas_agendas: o membro vê os números de todas as agendas (e a retenção de outra)", async () => {
    await permissoes(ids.hugo, { todas_agendas: true });
    expect(await como(HUGO, () => um(resumo))).toEqual({ inscritos: 2, compraram: 2, receita: 3000 });
    const ret = await como(HUGO, () => db.query<{ presentes: number }>(`select presentes from dashboard_retencao('${ids.sVendas}')`));
    expect(ret.rows.some((r) => r.presentes > 0)).toBe(true);
  });
});

describe("grants por coluna (contato do lead)", () => {
  // Toda coluna de inscricoes/eventos tem que estar liberada pra equipe, menos as escondidas de propósito. Coluna nova
  // sem grant quebra a tela (o select falha): este teste pega antes do deploy.
  const ESCONDIDAS: Record<string, string[]> = { inscricoes: ["whatsapp", "email", "respostas"], eventos: ["corpo", "mensagem", "resposta"] };

  for (const [tabela, escondidas] of Object.entries(ESCONDIDAS)) {
    it(`${tabela}: authenticated lê todas as colunas menos ${escondidas.join(", ")}`, async () => {
      const { rows } = await db.query<{ coluna: string; pode: boolean }>(
        `select column_name as coluna, has_column_privilege('authenticated', 'public.${tabela}', column_name, 'select') as pode
         from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`,
        [tabela],
      );
      expect(rows.length).toBeGreaterThan(escondidas.length);
      for (const r of rows) expect(r.pode, `${tabela}.${r.coluna}`).toBe(!escondidas.includes(r.coluna));
      const anon = await um<{ n: number }>(
        `select count(*)::int as n from information_schema.columns
         where table_schema = 'public' and table_name = $1 and has_column_privilege('anon', 'public.${tabela}', column_name, 'select')`,
        [tabela],
      );
      expect(anon.n).toBe(0);
    });
  }
});

describe("fichas: apagar", () => {
  it("o membro apaga a ficha de lead da agenda dele (como antes), não a de outra; sem ficha, nenhuma", async () => {
    await como(HUGO, () => db.query("delete from fichas"));
    expect((await db.query("select whatsapp from fichas")).rows).toEqual([{ whatsapp: "+551130000002" }]);
    await db.query("insert into fichas (whatsapp, observacoes) values ('+551130000001', 'impl')");
    await permissoes(ids.hugo, { ficha: false });
    await como(HUGO, () => db.query("delete from fichas"));
    expect(await contar("fichas")).toBe(2);
  });
});
