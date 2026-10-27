import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

const MEMBRO = "11111111-1111-4111-8111-111111111111";
const ESTRANHO = "22222222-2222-4222-8222-222222222222";
let db: PGlite;

beforeEach(async () => {
  db = await bancoComMigracoes();
  await db.query("insert into auth.users (id, email) values ($1, 'ana@x.com'), ($2, 'bia@x.com')", [MEMBRO, ESTRANHO]);
  await db.query("insert into usuarios (auth_id, nome, email) values ($1, 'Ana', 'ana@x.com')", [MEMBRO]);
  await db.query("insert into fichas (whatsapp, observacoes) values ('+551137654321', 'gosta de áudio')");
});

async function comoLogado(uid: string) {
  await db.query("select set_config('app.uid', $1, false)", [uid]);
  await db.exec("set role authenticated");
}

describe("fichas", () => {
  it("tem RLS ligado", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'fichas'");
    expect(rows).toEqual([{ relrowsecurity: true }]);
  });

  it("recusa WhatsApp fora do E.164 e observação gigante", async () => {
    await expect(db.query("insert into fichas (whatsapp) values ('1137654321')")).rejects.toThrow();
    await expect(db.query("insert into fichas (whatsapp, observacoes) values ('+551132345678', repeat('a', 10001))")).rejects.toThrow();
  });

  it("observações nascem vazias", async () => {
    await db.query("insert into fichas (whatsapp) values ('+551132345678')");
    const { rows } = await db.query<{ observacoes: string; resumo_ia: string | null }>(
      "select observacoes, resumo_ia from fichas where whatsapp = '+551132345678'",
    );
    expect(rows).toEqual([{ observacoes: "", resumo_ia: null }]);
  });

  it("anônimo não lê nem grava", async () => {
    await db.exec("set role anon");
    await expect(db.query("select * from fichas")).rejects.toThrow();
    await expect(db.query("insert into fichas (whatsapp) values ('+551132345678')")).rejects.toThrow();
    await db.exec("reset role");
  });

  it("logado que não é da equipe não vê nada nem grava", async () => {
    await comoLogado(ESTRANHO);
    const { rows } = await db.query("select * from fichas");
    expect(rows).toEqual([]);
    await expect(db.query("insert into fichas (whatsapp) values ('+551132345678')")).rejects.toThrow();
    await db.exec("reset role");
  });

  it("membro lê, cria e atualiza a ficha de quem se inscreveu numa agenda dele", async () => {
    const { rows: [ag] } = await db.query<{ id: string }>(
      "insert into agendas (nome, slug, responsavel_id) select 'Vendas', 'vendas', id from usuarios where auth_id = $1 returning id",
      [MEMBRO],
    );
    const { rows: [s] } = await db.query<{ id: string }>("insert into sessoes (agenda_id, inicio, vagas) values ($1, now(), 30) returning id", [ag.id]);
    await db.query(
      "insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp, status) values ($1, $2, 'aaaaaaaaa1', 'A', '+551137654321', 'faltou'), ($1, $2, 'aaaaaaaaa2', 'B', '+551132345678', 'agendado')",
      [s.id, ag.id],
    );
    await comoLogado(MEMBRO);
    const { rows } = await db.query<{ observacoes: string }>("select observacoes from fichas");
    expect(rows).toEqual([{ observacoes: "gosta de áudio" }]);
    await db.query(
      "insert into fichas (whatsapp, observacoes) values ('+551132345678', 'nova') on conflict (whatsapp) do update set observacoes = excluded.observacoes",
    );
    await db.query("update fichas set resumo_ia = 'resumo', resumo_em = now() where whatsapp = '+551137654321'");
    await db.exec("reset role");
    const { rows: depois } = await db.query<{ total: number }>(
      "select count(*)::int as total from fichas where resumo_ia = 'resumo' or observacoes = 'nova'",
    );
    expect(depois[0].total).toBe(2);
  });
});
