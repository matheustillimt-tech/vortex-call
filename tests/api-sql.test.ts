import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

let db: PGlite;
let usuario: string;
let chave: string;

beforeEach(async () => {
  db = await bancoComMigracoes();
  const { rows: auth } = await db.query<{ id: string }>("insert into auth.users (id, email) values (gen_random_uuid(), 'admin@x.com') returning id");
  usuario = (
    await db.query<{ id: string }>("insert into usuarios (auth_id, nome, email, papel) values ($1, 'Admin', 'admin@x.com', 'admin') returning id", [
      auth[0].id,
    ])
  ).rows[0].id;
  chave = (
    await db.query<{ id: string }>(
      "insert into chaves_api (nome, permissao, prefixo, hash, criada_por) values ('Claude', 'escrita', 'ABCDEFGH', 'hash1', $1) returning id",
      [usuario],
    )
  ).rows[0].id;
});

describe("tabelas da migração 20261023150000_api.sql", () => {
  it("chaves_api guarda prefixo, hash único e permissão restrita", async () => {
    const { rows } = await db.query<{ nome: string; permissao: string; prefixo: string }>("select nome, permissao, prefixo from chaves_api where id = $1", [
      chave,
    ]);
    expect(rows[0]).toEqual({ nome: "Claude", permissao: "escrita", prefixo: "ABCDEFGH" });
    await expect(
      db.query("insert into chaves_api (nome, permissao, prefixo, hash) values ('Outra', 'leitura', 'IJKLMNOP', 'hash1')"),
    ).rejects.toThrow();
  });

  it("recusa permissão fora de leitura/escrita", async () => {
    await expect(
      db.query("insert into chaves_api (nome, permissao, prefixo, hash) values ('X', 'admin', 'QRSTUVWX', 'hash2')"),
    ).rejects.toThrow();
  });

  it("recusa nome vazio ou maior que 60 caracteres", async () => {
    await expect(db.query("insert into chaves_api (nome, permissao, prefixo, hash) values ('', 'leitura', 'QRSTUVWX', 'hash3')")).rejects.toThrow();
    await expect(
      db.query("insert into chaves_api (nome, permissao, prefixo, hash) values ($1, 'leitura', 'QRSTUVWX', 'hash4')", ["x".repeat(61)]),
    ).rejects.toThrow();
  });
});

describe("api_registrar_uso", () => {
  it("soma as chamadas no mesmo minuto e marca o último uso", async () => {
    const a = await db.query<{ total: number }>("select api_registrar_uso($1) as total", [chave]);
    expect(a.rows[0].total).toBe(1);
    const b = await db.query<{ total: number }>("select api_registrar_uso($1) as total", [chave]);
    expect(b.rows[0].total).toBe(2);
    const { rows } = await db.query<{ ultimo_uso: string | null }>("select ultimo_uso from chaves_api where id = $1", [chave]);
    expect(rows[0].ultimo_uso).not.toBeNull();
  });

  it("limpa os minutos com mais de uma hora da mesma chave", async () => {
    await db.query("insert into api_uso (chave_id, minuto, chamadas) values ($1, now() - interval '2 hours', 5)", [chave]);
    await db.query("select api_registrar_uso($1)", [chave]);
    const { rows } = await db.query<{ total: number }>("select count(*)::int as total from api_uso where chave_id = $1 and minuto < now() - interval '1 hour'", [
      chave,
    ]);
    expect(rows[0].total).toBe(0);
  });

  it("não mexe nos minutos antigos de outra chave", async () => {
    const outra = (
      await db.query<{ id: string }>(
        "insert into chaves_api (nome, permissao, prefixo, hash, criada_por) values ('Outra', 'leitura', 'IJKLMNOP', 'hash9', $1) returning id",
        [usuario],
      )
    ).rows[0].id;
    await db.query("insert into api_uso (chave_id, minuto, chamadas) values ($1, now() - interval '2 hours', 5)", [outra]);
    await db.query("select api_registrar_uso($1)", [chave]);
    const { rows } = await db.query<{ total: number }>("select count(*)::int as total from api_uso where chave_id = $1", [outra]);
    expect(rows[0].total).toBe(1);
  });
});

describe("RLS", () => {
  it("liga em chaves_api e api_uso", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('chaves_api','api_uso') order by 1",
    );
    expect(rows).toEqual([
      { relname: "api_uso", relrowsecurity: true },
      { relname: "chaves_api", relrowsecurity: true },
    ]);
  });
});
