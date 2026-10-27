import { describe, expect, it } from "vitest";
import { ehCodigoValido, gerarCodigo } from "@/src/lib/regras/codigo";

describe("código do link pessoal", () => {
  it("tem 10 caracteres sem letras que confundem", () => {
    for (let i = 0; i < 200; i++) {
      const c = gerarCodigo();
      expect(c).toMatch(/^[a-z0-9]{10}$/);
      expect(c).not.toMatch(/[01oli]/);
      expect(ehCodigoValido(c)).toBe(true);
    }
  });
  it("é determinístico com o mesmo gerador", () => {
    const fixo = (n: number) => new Uint8Array(n).fill(7);
    expect(gerarCodigo(fixo)).toBe(gerarCodigo(fixo));
  });
  it("recusa código malformado", () => {
    expect(ehCodigoValido("ABC")).toBe(false);
    expect(ehCodigoValido("abc123def4x")).toBe(false);
    expect(ehCodigoValido("abc-23def4")).toBe(false);
  });
});
