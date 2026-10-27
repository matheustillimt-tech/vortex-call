import { describe, expect, it } from "vitest";
import { validarInscricao } from "@/src/lib/regras/inscricao";

const ok = { sessao: "8a8f2d9e-2b1c-4c55-9f0a-0f6a3b7f1d11", nome: " Maria Silva ", whatsapp: "(11) 3765-4321", email: "MARIA@x.com " };

describe("validarInscricao", () => {
  it("normaliza nome, WhatsApp e e-mail", () => {
    expect(validarInscricao(ok).dados).toMatchObject({ nome: "Maria Silva", whatsapp: "+551137654321", email: "maria@x.com", origem: "pagina", utm: {} });
  });
  it("pede WhatsApp válido", () => {
    expect(validarInscricao({ ...ok, whatsapp: "123" }).erro).toBe("Confira o WhatsApp com DDD.");
  });
  it("pede nome", () => {
    expect(validarInscricao({ ...ok, nome: "" }).erro).toBe("Informe seu nome.");
  });
  it("recusa sessão que não é uuid", () => {
    expect(validarInscricao({ ...ok, sessao: "x" }).erro).toBe("Escolha um horário.");
  });
  it("e-mail é opcional mas, se vier, tem que ser válido", () => {
    expect(validarInscricao({ ...ok, email: "" }).dados?.email).toBeNull();
    expect(validarInscricao({ ...ok, email: "nao-e-email" }).erro).toBe("Confira o e-mail.");
  });
  it("guarda só UTMs conhecidas e com texto curto", () => {
    const d = validarInscricao({ ...ok, utm: { utm_source: "ig", utm_campaign: "x".repeat(300), outra: "y" } }).dados!;
    expect(d.utm).toEqual({ utm_source: "ig", utm_campaign: "x".repeat(200) });
  });
  it("aceita origem encaixe", () => {
    expect(validarInscricao({ ...ok, origem: "encaixe" }).dados?.origem).toBe("encaixe");
    expect(validarInscricao({ ...ok, origem: "painel" }).dados?.origem).toBe("pagina");
  });
  it("recusa respostas grandes demais", () => {
    expect(validarInscricao({ ...ok, respostas: { texto: "x".repeat(6000) } }).erro).toBe("Respostas grandes demais.");
    expect(validarInscricao({ ...ok, respostas: { texto: "ok" } }).dados?.respostas).toEqual({ texto: "ok" });
  });
});
