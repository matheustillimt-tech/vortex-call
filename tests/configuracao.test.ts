import { describe, expect, it } from "vitest";
import { lerCrmEquipe, validarConfiguracao } from "@/src/lib/regras/configuracao";

function form(c: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(c)) f.set(k, v);
  return f;
}

describe("validarConfiguracao", () => {
  it("aceita marca completa e normaliza o WhatsApp", () => {
    expect(validarConfiguracao(form({ nome: "Sua Empresa", logo_url: "https://x.com/logo.png", cor_marca: "#0A8452", whatsapp_suporte: "(11) 3765-4321" })).dados).toEqual({
      nome: "Sua Empresa", logo_url: "https://x.com/logo.png", cor_marca: "#0a8452", whatsapp_suporte: "+551137654321",
    });
  });
  it("recusa cor e logo inválidos", () => {
    expect(validarConfiguracao(form({ nome: "V", cor_marca: "verde" })).erro).toBe("Cor no formato #RRGGBB.");
    expect(validarConfiguracao(form({ nome: "V", cor_marca: "#000000", logo_url: "javascript:alert(1)" })).erro).toBe("Logo precisa ser um link https.");
  });
});

describe("lerCrmEquipe (avisos pra equipe)", () => {
  it("URL https ou vazia; segredo em branco mantém, caixa remove", () => {
    expect(lerCrmEquipe(form({ crm_url_equipe: " https://crm.test/equipe " }))).toEqual({ crm_url_equipe: "https://crm.test/equipe" });
    expect(lerCrmEquipe(form({ crm_url_equipe: "" }))).toEqual({ crm_url_equipe: null });
    expect(lerCrmEquipe(form({ crm_url_equipe: "http://crm.test" })).erro).toBe("URL dos avisos da equipe: use um endereço https:// de até 500 caracteres.");
    expect(lerCrmEquipe(form({ crm_url_equipe: "", crm_segredo_equipe: " abc " }))).toEqual({ crm_url_equipe: null, crm_segredo_equipe: "abc" });
    expect(lerCrmEquipe(form({ crm_url_equipe: "", crm_segredo_equipe: "abc", crm_remover_segredo_equipe: "on" }))).toEqual({ crm_url_equipe: null, crm_segredo_equipe: null });
    expect(lerCrmEquipe(form({ crm_segredo_equipe: "x".repeat(201) })).erro).toBe("Segredo: até 200 caracteres.");
  });
});
