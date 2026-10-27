import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

let db: PGlite;
let sessao: string;

beforeAll(async () => {
  // Com os privilégios padrão do Supabase (toda tabela nasce com grant): a migração tem que tirar.
  db = await bancoComMigracoes({ privilegiosSupabase: true });
  const { rows: [a] } = await db.query<{ id: string }>("insert into agendas (nome, slug) values ('Vendas', 'vendas-convite') returning id");
  const { rows: [s] } = await db.query<{ id: string }>("insert into sessoes (agenda_id, inicio, vagas) values ($1, now(), 10) returning id", [a.id]);
  sessao = s.id;
  await db.query("insert into convites_sessao (sessao_id, codigo) values ($1, 'AbCdEfGhIjKlMnOpQrStUv')", [sessao]);
});

describe("convites_sessao", () => {
  it("um código por sessão, único e no formato url-safe de 22", async () => {
    await expect(db.query("insert into convites_sessao (sessao_id, codigo) values ($1, 'BbCdEfGhIjKlMnOpQrStUv')", [sessao])).rejects.toThrow();
    await expect(db.query("insert into convites_sessao (sessao_id, codigo) values (gen_random_uuid(), 'curto')")).rejects.toThrow();
  });

  it("equipe e anônimo não leem o código (só a service role)", async () => {
    for (const papel of ["authenticated", "anon"]) {
      await db.exec(`set role ${papel}`);
      await expect(db.query("select codigo from convites_sessao")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("apagar a sessão apaga o link", async () => {
    await db.query("delete from sessoes where id = $1", [sessao]);
    const { rows } = await db.query("select 1 from convites_sessao");
    expect(rows).toHaveLength(0);
  });
});
