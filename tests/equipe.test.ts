import { describe, expect, it } from "vitest";
import { lerWhatsappEquipe, validarPessoa } from "@/src/lib/regras/equipe";

const base = { nome: "Ana", email: "ana@exemplo.com", senha: "senha1234", papel: "membro" };

describe("validarPessoa", () => {
  it("aceita admin e membro", () => {
    expect(validarPessoa(base)).toBeNull();
    expect(validarPessoa({ ...base, papel: "admin" })).toBeNull();
  });
  it("recusa o papel antigo do Webinar", () => {
    expect(validarPessoa({ ...base, papel: "atendente" })).toBe("Papel inválido.");
  });
  it("pede senha com letra e número", () => {
    expect(validarPessoa({ ...base, senha: "12345678" })).toMatch(/letra e número/);
  });
});

describe("lerWhatsappEquipe", () => {
  it("vazio = sem WhatsApp; número vira E.164; inválido erra", () => {
    expect(lerWhatsappEquipe("")).toEqual({ whatsapp: null });
    expect(lerWhatsappEquipe("  ")).toEqual({ whatsapp: null });
    expect(lerWhatsappEquipe("(11) 3765-4321")).toEqual({ whatsapp: "+551137654321" });
    expect(lerWhatsappEquipe("+351 212 345 678")).toEqual({ whatsapp: "+351212345678" });
    expect(lerWhatsappEquipe("123")).toEqual({ erro: "Confira o WhatsApp (com DDD)." });
  });
});
