import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

const GABRIEL = "11111111-1111-4111-8111-111111111111";
const HUGO = "22222222-2222-4222-8222-222222222222";
const OLAVO = "33333333-3333-4333-8333-333333333333";
const ESTRANHO = "44444444-4444-4444-8444-444444444444";

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

/** Sessão de 60 min que já aconteceu. `entrou` = minutos ANTES do início em que o anfitrião entrou (negativo = atraso). */
async function sessao(agenda: string, inicio: string, anfitriao: string | null, entrou: number | null, aberta = true): Promise<string> {
  return (
    await um<{ id: string }>(
      `insert into sessoes (agenda_id, inicio, vagas, status, aberta_em, anfitriao_id, anfitriao_entrou_em)
       values ($1, $2::timestamptz, 30, $3, case when $4 then $2::timestamptz else null end, $5,
               case when $6::int is null then null else $2::timestamptz - make_interval(mins => $6::int) end) returning id`,
      [agenda, inicio, aberta ? "encerrada" : "agendada", aberta, anfitriao, entrou],
    )
  ).id;
}

async function inscricao(sessaoId: string, agenda: string, veio: boolean, venda = 0): Promise<string> {
  seq++;
  const { id } = await um<{ id: string }>(
    "insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp, status, minutos_na_sala) values ($1, $2, $3, 'Lead', $4, $5, $6) returning id",
    [sessaoId, agenda, `d${String(seq).padStart(9, "0")}`, `+55119${String(seq).padStart(8, "0")}`, veio ? "compareceu" : "faltou", veio ? 60 : 0],
  );
  if (venda > 0) {
    await db.query("insert into vendas (order_id, status, valor_centavos, inscricao_id, sessao_id) values ($1, 'aprovada', $2, $3, $4)", [`o${seq}`, venda, id, sessaoId]);
  }
  return id;
}

beforeEach(async () => {
  db = await bancoComMigracoes({ privilegiosSupabase: true });
  await db.query("insert into auth.users (id, email) values ($1, 'g@x'), ($2, 'h@x'), ($3, 'o@x'), ($4, 'e@x')", [GABRIEL, HUGO, OLAVO, ESTRANHO]);
  const u = async (auth: string, nome: string, papel: string) =>
    (await um<{ id: string }>("insert into usuarios (auth_id, nome, email, papel) values ($1, $2, $3, $4) returning id", [auth, nome, `${nome}@x`, papel])).id;
  ids = { gabriel: await u(GABRIEL, "Gabriel", "admin"), hugo: await u(HUGO, "Hugo Prado", "membro"), olavo: await u(OLAVO, "Olavo", "membro") };
  ids.agImpl = (await um<{ id: string }>("insert into agendas (nome, slug, duracao_min, responsavel_id) values ('Implementação', 'impl', 60, $1) returning id", [ids.hugo])).id;
  ids.agVendas = (await um<{ id: string }>("insert into agendas (nome, slug, duracao_min, responsavel_id) values ('Vendas', 'vendas', 60, $1) returning id", [ids.olavo])).id;

  // Hugo conduziu s1 (entrou 5 min antes): 2 inscritos, 1 veio e comprou R$ 10.
  ids.s1 = await sessao(ids.agImpl, "2026-10-20T12:00:00Z", ids.hugo, 5);
  await inscricao(ids.s1, ids.agImpl, true, 1000);
  await inscricao(ids.s1, ids.agImpl, false);
  // Gabriel conduziu s2 na agenda do Hugo (entrou 2 min atrasado): conta pro Gabriel.
  ids.s2 = await sessao(ids.agImpl, "2026-10-21T12:00:00Z", ids.gabriel, -2);
  await inscricao(ids.s2, ids.agImpl, true);
  // s3: ninguém abriu (sem anfitrião): conta pro responsável (Hugo).
  ids.s3 = await sessao(ids.agImpl, "2026-10-22T12:00:00Z", null, null, false);
  await inscricao(ids.s3, ids.agImpl, false);
  // Olavo conduziu s4 na agenda dele (10 min antes): 1 veio e comprou R$ 5.
  ids.s4 = await sessao(ids.agVendas, "2026-10-22T15:00:00Z", ids.olavo, 10);
  ids.i4 = await inscricao(ids.s4, ids.agVendas, true, 500);
  await db.query("insert into presencas (sessao_id, inscricao_id, peer_id, entrou_em, saiu_em) values ($1, $2, 'p4', '2026-10-22T15:00:00Z', '2026-10-22T15:30:00Z')", [ids.s4, ids.i4]);
});

type LinhaVendedor = Record<string, unknown>;
const normalizar = (r: LinhaVendedor): LinhaVendedor => ({
  ...r,
  receita_centavos: Number(r.receita_centavos),
  nota_media: r.nota_media === null ? null : Number(r.nota_media),
  antecedencia_media_min: r.antecedencia_media_min === null ? null : Number(r.antecedencia_media_min),
});

describe("dashboard_vendedores", () => {
  it("admin: uma linha por vendedor (anfitrião, senão o responsável da agenda)", async () => {
    await comoLogado(GABRIEL);
    const rows = (await db.query<LinhaVendedor>("select * from dashboard_vendedores(null, null, null, null) order by nome")).rows.map(normalizar);
    expect(rows.map((r) => [r.nome, r.realizadas, r.conduzidas, r.sem_anfitriao, r.antecedencia_media_min])).toEqual([
      ["Gabriel", 1, 1, 0, -2],
      ["Hugo Prado", 1, 1, 1, 5],
      ["Olavo", 1, 1, 0, 10],
    ]);
    const h = rows.find((r) => r.nome === "Hugo Prado")!;
    expect(h).toMatchObject({ vendedor_id: ids.hugo, sessoes: 2, inscritos: 3, vieram: 1, compraram: 1, receita_centavos: 1000 });
    const o = rows.find((r) => r.nome === "Olavo")!;
    expect(o).toMatchObject({ inscritos: 1, vieram: 1, compraram: 1, receita_centavos: 500 });
    await comoServidor();
  });

  it("admin filtra por vendedor e por agenda", async () => {
    await comoLogado(GABRIEL);
    const soH = (await db.query<LinhaVendedor>("select vendedor_id from dashboard_vendedores(null, null, null, $1)", [ids.hugo])).rows;
    expect(soH).toEqual([{ vendedor_id: ids.hugo }]);
    const soVendas = (await db.query<LinhaVendedor>("select vendedor_id from dashboard_vendedores(null, null, $1, null)", [ids.agVendas])).rows;
    expect(soVendas).toEqual([{ vendedor_id: ids.olavo }]);
    const periodo = (await db.query<LinhaVendedor>("select nome from dashboard_vendedores('2026-10-22T00:00:00Z', '2026-10-23T00:00:00Z', null, null) order by nome")).rows;
    expect(periodo).toEqual([{ nome: "Hugo Prado" }, { nome: "Olavo" }]);
    await comoServidor();
  });

  it("membro vê uma linha só, com todas as sessões das agendas dele (bate com os cartões do funil)", async () => {
    await comoLogado(HUGO);
    const rows = (await db.query<LinhaVendedor>("select * from dashboard_vendedores(null, null, null, null)")).rows.map(normalizar);
    expect(rows).toHaveLength(1);
    // s1 (ele conduziu), s2 (Gabriel conduziu na agenda dele) e s3 (sem anfitrião).
    expect(rows[0]).toMatchObject({
      vendedor_id: ids.hugo, nome: "Hugo Prado", sessoes: 3, realizadas: 2, conduzidas: 1, sem_anfitriao: 1,
      antecedencia_media_min: 5, inscritos: 4, vieram: 2, compraram: 1, receita_centavos: 1000,
    });
    const funil = await um<{ inscritos: number; vieram: number }>("select inscritos, vieram from dashboard_resumo(null, null, null, null)");
    expect({ inscritos: rows[0].inscritos, vieram: rows[0].vieram }).toEqual(funil);
    // Pedir o Olavo não adianta: continua a linha dele, só com as agendas dele.
    const outro = (await db.query<LinhaVendedor>("select vendedor_id, inscritos from dashboard_vendedores(null, null, null, $1)", [ids.olavo])).rows;
    expect(outro).toEqual([{ vendedor_id: ids.hugo, inscritos: 4 }]);
    await comoServidor();
  });

  it("quem não é da equipe não usa", async () => {
    await comoLogado(ESTRANHO);
    await expect(db.query("select * from dashboard_vendedores(null, null, null, null)")).rejects.toThrow();
    await comoServidor();
  });
});

describe("dashboard recortado pelo vendedor", () => {
  it("membro: resumo e sessões só das agendas dele, mesmo pedindo outra", async () => {
    await comoLogado(HUGO);
    expect(await um("select inscritos, vieram from dashboard_resumo(null, null, null, null)")).toEqual({ inscritos: 4, vieram: 2 });
    expect(await um("select inscritos from dashboard_resumo(null, null, $1, null)", [ids.agVendas])).toEqual({ inscritos: 0 });
    expect(await um("select inscritos from dashboard_resumo(null, null, null, $1)", [ids.s4])).toEqual({ inscritos: 0 });
    const sessoes = (await db.query<{ id: string }>("select id from dashboard_sessoes(null, null, null, null) order by inicio")).rows.map((r) => r.id);
    expect(sessoes).toEqual([ids.s1, ids.s2, ids.s3]);
    expect((await db.query("select * from dashboard_retencao($1)", [ids.s4])).rows).toEqual([]);
    expect((await db.query("select * from dashboard_retencao($1)", [ids.s1])).rows.length).toBeGreaterThan(0);
    await comoServidor();
  });

  it("admin: tudo, e o filtro de vendedor usa o anfitrião (senão o responsável)", async () => {
    await comoLogado(GABRIEL);
    expect(await um("select inscritos from dashboard_resumo(null, null, null, null)")).toEqual({ inscritos: 5 });
    expect(await um("select inscritos, compraram from dashboard_resumo(null, null, null, null, $1)", [ids.hugo])).toEqual({ inscritos: 3, compraram: 1 });
    expect(await um("select inscritos from dashboard_resumo(null, null, null, null, $1)", [ids.gabriel])).toEqual({ inscritos: 1 });
    const s = (await db.query<{ id: string; anfitriao: string | null }>("select id, anfitriao from dashboard_sessoes(null, null, null, null, $1) order by inicio", [ids.hugo])).rows;
    expect(s).toEqual([{ id: ids.s1, anfitriao: "Hugo Prado" }, { id: ids.s3, anfitriao: null }]);
    await comoServidor();
  });
});
