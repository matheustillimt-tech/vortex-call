import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

let db: PGlite;
let usuario: string;

beforeEach(async () => {
  db = await bancoComMigracoes();
  await db.query("insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'bento@x.com')");
  usuario = (await db.query<{ id: string }>(
    "insert into usuarios (auth_id, nome, email, papel) values ('00000000-0000-0000-0000-000000000001', 'Bento', 'bento@x.com', 'membro') returning id",
  )).rows[0].id;
});

const inserir = (codigo: string, extra = "") =>
  db.query(`insert into reunioes (codigo, criada_por, expira_em${extra ? ", rtk_meeting_id" : ""}) values ($1, $2, now() + interval '24 hours'${extra ? ", $3" : ""})`, extra ? [codigo, usuario, extra] : [codigo, usuario]);

describe("reunioes", () => {
  it("nasce com título padrão 'Reunião rápida' e sem encerrada_em", async () => {
    await inserir("abcdefghjk");
    const { rows } = await db.query<{ titulo: string; encerrada_em: string | null }>("select titulo, encerrada_em from reunioes");
    expect(rows).toEqual([{ titulo: "Reunião rápida", encerrada_em: null }]);
  });
  it("código único e no formato de 10 caracteres [a-z0-9]", async () => {
    await inserir("abcdefghjk");
    await expect(inserir("abcdefghjk")).rejects.toThrow();
    await expect(inserir("curto")).rejects.toThrow();
    await expect(inserir("ABCDEFGHJK")).rejects.toThrow();
  });
  it("rtk_meeting_id é único", async () => {
    await inserir("abcdefghjk", "m1");
    await expect(inserir("bcdefghjkm", "m1")).rejects.toThrow();
  });
  it("expira_em é obrigatório", async () => {
    await expect(db.query("insert into reunioes (codigo) values ('abcdefghjk')")).rejects.toThrow();
  });
  it("apagar o usuário deixa criada_por nulo", async () => {
    await inserir("abcdefghjk");
    await db.query("delete from usuarios where id = $1", [usuario]);
    const { rows } = await db.query<{ criada_por: string | null }>("select criada_por from reunioes");
    expect(rows).toEqual([{ criada_por: null }]);
  });
  it("updated_at muda no update", async () => {
    await db.query("insert into reunioes (codigo, expira_em, updated_at) values ('abcdefghjk', now() + interval '1 day', '2020-01-01')");
    await db.query("update reunioes set encerrada_em = now()");
    const { rows } = await db.query<{ antigo: boolean }>("select updated_at < '2021-01-01' as antigo from reunioes");
    expect(rows[0].antigo).toBe(false);
  });
  it("RLS ligada com só admin_tudo e membro_le", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'reunioes'");
    expect(rows).toEqual([{ relrowsecurity: true }]);
    const pol = await db.query<{ policyname: string; cmd: string }>("select policyname, cmd from pg_policies where tablename = 'reunioes' order by 1");
    expect(pol.rows).toEqual([{ policyname: "admin_tudo", cmd: "ALL" }, { policyname: "membro_le", cmd: "SELECT" }]);
  });
});

describe("gravacoes.reuniao_id", () => {
  it("liga a gravação à reunião e vai junto se a reunião for apagada (etapa 7)", async () => {
    await inserir("abcdefghjk");
    const r = (await db.query<{ id: string }>("select id from reunioes")).rows[0].id;
    await db.query("insert into gravacoes (rtk_recording_id, status, reuniao_id) values ('r1', 'UPLOADED', $1)", [r]);
    await db.query("delete from reunioes where id = $1", [r]);
    const { rows } = await db.query("select reuniao_id from gravacoes");
    expect(rows).toEqual([]);
  });
});
