import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

let db: PGlite;

beforeEach(async () => {
  db = await bancoComMigracoes();
});

async function contar(chave: string, janela: string) {
  const { rows } = await db.query<{ contar_limite: number }>("select contar_limite($1, $2)", [chave, janela]);
  return rows[0].contar_limite;
}

describe("contar_limite", () => {
  it("conta 1, 2, 3 na mesma chave e janela", async () => {
    const janela = "2026-10-27T12:00:00Z";
    expect(await contar("inscrever:abc", janela)).toBe(1);
    expect(await contar("inscrever:abc", janela)).toBe(2);
    expect(await contar("inscrever:abc", janela)).toBe(3);
  });

  it("outra janela recomeça em 1", async () => {
    const chave = "inscrever:abc";
    expect(await contar(chave, "2026-10-27T12:00:00Z")).toBe(1);
    expect(await contar(chave, "2026-10-27T12:00:00Z")).toBe(2);
    expect(await contar(chave, "2026-10-27T12:01:00Z")).toBe(1);
  });
});
