import { describe, expect, it, vi } from "vitest";
import { FORMATO_CHAVE, criarChave, gerarChave, hashDaChave, prefixoDaChave, revogarChave } from "@/src/lib/mcp/chaves";

function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "is", "insert", "update", "single"]) p[m] = () => p;
  return p;
}

describe("gerarChave", () => {
  it("formato vc_ + 40 caracteres base62", () => {
    for (let i = 0; i < 20; i++) expect(gerarChave()).toMatch(FORMATO_CHAVE);
  });

  it("não repete (amostra de 200)", () => {
    const chaves = new Set(Array.from({ length: 200 }, () => gerarChave()));
    expect(chaves.size).toBe(200);
  });

  it("usa os 62 caracteres sem viés perceptível (amostra grande)", () => {
    const contagem: Record<string, number> = {};
    for (let i = 0; i < 300; i++) {
      for (const c of gerarChave().slice(3)) contagem[c] = (contagem[c] ?? 0) + 1;
    }
    // 300 chaves * 40 caracteres = 12000 amostras / 62 símbolos ~= 193.5 cada; sem viés nenhum símbolo fica perto de 0.
    const valores = Object.values(contagem);
    expect(valores.length).toBeGreaterThan(50);
    expect(Math.min(...valores)).toBeGreaterThan(50);
  });
});

describe("hashDaChave / prefixoDaChave", () => {
  it("hash é SHA-256 hex (64 caracteres) e determinístico", () => {
    const chave = gerarChave();
    const h1 = hashDaChave(chave);
    const h2 = hashDaChave(chave);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });

  it("chaves diferentes dão hashes diferentes", () => {
    expect(hashDaChave(gerarChave())).not.toBe(hashDaChave(gerarChave()));
  });

  it("prefixo são os 8 caracteres depois de vc_", () => {
    const chave = `vc_${"A".repeat(40)}`;
    expect(prefixoDaChave(chave)).toBe("AAAAAAAA");
  });
});

describe("criarChave", () => {
  it("recusa nome vazio ou maior que 60 caracteres", async () => {
    const db = { from: vi.fn() };
    expect(await criarChave(db, { nome: "", permissao: "leitura", criadaPor: "u1" })).toEqual({ erro: "Nome da chave: de 1 a 60 caracteres." });
    expect(await criarChave(db, { nome: "x".repeat(61), permissao: "leitura", criadaPor: "u1" })).toEqual({
      erro: "Nome da chave: de 1 a 60 caracteres.",
    });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("recusa permissão inválida", async () => {
    const db = { from: vi.fn() };
    expect(await criarChave(db, { nome: "Claude", permissao: "admin", criadaPor: "u1" })).toEqual({ erro: "Permissão inválida." });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("grava nome, permissão, prefixo e hash, e devolve a chave em texto uma vez", async () => {
    const insert = vi.fn().mockReturnValue(chain({ data: { id: "chave-1" }, error: null }));
    const db = { from: vi.fn().mockReturnValue({ insert }) };
    const r = await criarChave(db, { nome: "  Claude  ", permissao: "escrita", criadaPor: "u1" });
    expect(r).toMatchObject({ id: "chave-1" });
    expect((r as { chave: string }).chave).toMatch(FORMATO_CHAVE);
    const gravado = insert.mock.calls[0][0];
    expect(gravado.nome).toBe("Claude");
    expect(gravado.permissao).toBe("escrita");
    expect(gravado.criada_por).toBe("u1");
    expect(gravado.prefixo).toBe(prefixoDaChave((r as { chave: string }).chave));
    expect(gravado.hash).toBe(hashDaChave((r as { chave: string }).chave));
  });

  it("erro do banco na criação", async () => {
    const insert = vi.fn().mockReturnValue(chain({ data: null, error: { message: "x" } }));
    const db = { from: vi.fn().mockReturnValue({ insert }) };
    expect(await criarChave(db, { nome: "Claude", permissao: "leitura", criadaPor: "u1" })).toEqual({ erro: "Não deu para criar a chave." });
  });
});

describe("revogarChave", () => {
  it("marca revogada_em quando encontra a chave ativa", async () => {
    const update = vi.fn().mockReturnValue(chain({ data: [{ id: "c1" }], error: null }));
    const db = { from: vi.fn().mockReturnValue({ update }) };
    expect(await revogarChave(db, "c1")).toEqual({ ok: true });
    expect(update.mock.calls[0][0]).toHaveProperty("revogada_em");
  });

  it("chave não encontrada ou já revogada → erro, sem jogar exceção", async () => {
    const update = vi.fn().mockReturnValue(chain({ data: [], error: null }));
    const db = { from: vi.fn().mockReturnValue({ update }) };
    expect(await revogarChave(db, "c1")).toEqual({ erro: "Chave não encontrada ou já revogada." });
  });

  it("erro do banco na revogação", async () => {
    const update = vi.fn().mockReturnValue(chain({ data: null, error: { message: "x" } }));
    const db = { from: vi.fn().mockReturnValue({ update }) };
    expect(await revogarChave(db, "c1")).toEqual({ erro: "Não deu para revogar a chave." });
  });
});
