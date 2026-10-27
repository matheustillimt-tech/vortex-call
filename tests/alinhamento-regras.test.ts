import { describe, expect, it } from "vitest";
import {
  cortarParaPrompt, equipeDaTranscricao, lerAlinhamento, minutosDeFala, montarPromptAlinhamento, NAO_FALARAM, textoDoAlinhamento, TEXTO_MAX, type Alinhamento,
} from "@/src/lib/regras/alinhamento";
import type { Trecho } from "@/src/lib/regras/transcricao";

const t = (id: string, em: string, nome = "Ana", customId: string | null = "insc-1"): Trecho => ({ id, nome, customId, texto: "oi", em });
const cheio: Alinhamento = {
  negocio: "Clínica odontológica com 3 unidades", dor: "Perde lead no WhatsApp", quer: "Responder em 1 minuto",
  combinado: ["Mandar proposta até sexta"], escopo: ["Agente de atendimento", "Integração com a agenda"],
  orcamento_prazo: "", objecoes: ["Medo da IA errar o preço"], proximo_passo: "Gabriel manda a proposta até sexta",
  temperatura: "quente", temperatura_motivo: "Quer começar este mês",
};

describe("lerAlinhamento", () => {
  it("lê o JSON da IA, limpa espaços, valida a temperatura e corta listas", () => {
    const a = lerAlinhamento({ ...cheio, negocio: "  Clínica \n odontológica ", temperatura: "QUENTE", combinado: ["a", "", 3, ...Array(20).fill("x")] });
    expect(a?.negocio).toBe("Clínica odontológica");
    expect(a?.temperatura).toBe("quente");
    expect(a?.combinado).toHaveLength(8);
    expect(a?.combinado[0]).toBe("a");
    expect(lerAlinhamento({ ...cheio, temperatura: "pelando" })?.temperatura).toBeNull();
  });
  it("campos faltando viram vazio; nada aproveitável ou não objeto = null", () => {
    expect(lerAlinhamento({ dor: "x" })).toMatchObject({ dor: "x", negocio: "", combinado: [] });
    expect(lerAlinhamento({})).toBeNull();
    expect(lerAlinhamento({ negocio: "  ", combinado: [] })).toBeNull();
    expect(lerAlinhamento([])).toBeNull();
    expect(lerAlinhamento("texto")).toBeNull();
  });
});

describe("textoDoAlinhamento", () => {
  it("formato fixo, na ordem, com 'não falaram' no que ficou vazio", () => {
    expect(textoDoAlinhamento(cheio, "RESUMO DA CALL (26/10 15:00)")).toBe([
      "RESUMO DA CALL (26/10 15:00)",
      "Negócio: Clínica odontológica com 3 unidades",
      "Problema/dor: Perde lead no WhatsApp",
      "O que a pessoa quer: Responder em 1 minuto",
      "O que foi combinado: • Mandar proposta até sexta",
      "Escopo citado: • Agente de atendimento • Integração com a agenda",
      `Orçamento e prazo: ${NAO_FALARAM}`,
      "Objeções e dúvidas: • Medo da IA errar o preço",
      "Próximo passo: Gabriel manda a proposta até sexta",
      "Temperatura: quente — Quer começar este mês",
    ].join("\n"));
  });
  it("nunca passa de 2.500 caracteres", () => {
    const longo = { ...cheio, combinado: Array(8).fill("c".repeat(300)), escopo: Array(8).fill("e".repeat(300)), objecoes: Array(8).fill("o".repeat(300)) };
    const texto = textoDoAlinhamento(longo);
    expect(texto.length).toBeLessThanOrEqual(TEXTO_MAX);
    expect(texto).toContain("Próximo passo:");
  });
});

describe("prompt e apoio", () => {
  it("minutos de fala da primeira à última", () => {
    expect(minutosDeFala([])).toBe(0);
    expect(minutosDeFala([t("1", "2026-10-26T18:00:00Z")])).toBe(0);
    expect(minutosDeFala([t("2", "2026-10-26T18:04:30Z"), t("1", "2026-10-26T18:00:00Z")])).toBe(4.5);
  });
  it("transcrição grande vai cortada: começo e fim", () => {
    const r = cortarParaPrompt("a".repeat(100) + "b".repeat(100), 100);
    expect(r.startsWith("a".repeat(25))).toBe(true);
    expect(r.endsWith("b".repeat(75))).toBe(true);
    expect(r).toContain("cortado");
    expect(cortarParaPrompt("curta", 100)).toBe("curta");
  });
  it("prompt diz se a call ainda está acontecendo e quem é da equipe", () => {
    const p = montarPromptAlinhamento({ transcricao: "[15:00] Ana: oi", agenda: "Implementação", equipe: ["Gabriel"], final: false });
    expect(p.sistema).toContain("JSON");
    expect(p.usuario).toContain("ainda está acontecendo");
    expect(p.usuario).toContain("Equipe da empresa na call: Gabriel");
    expect(p.usuario).toContain("[15:00] Ana: oi");
    expect(montarPromptAlinhamento({ transcricao: "x", agenda: "A", equipe: [], final: true }).usuario).toContain("resumo final");
  });
  it("com NEXT_PUBLIC_EMPRESA_NOME e IA_SOBRE_A_EMPRESA, o pedido cita a empresa e o que ela vende", () => {
    const antes = { nome: process.env.NEXT_PUBLIC_EMPRESA_NOME, sobre: process.env.IA_SOBRE_A_EMPRESA };
    process.env.NEXT_PUBLIC_EMPRESA_NOME = "Sua Empresa";
    process.env.IA_SOBRE_A_EMPRESA = "consultoria de marketing";
    const p = montarPromptAlinhamento({ transcricao: "x", agenda: "A", equipe: ["Gabriel"], final: true });
    expect(p.sistema).toContain("call de vendas da Sua Empresa (consultoria de marketing) entre a equipe e um lead");
    expect(p.usuario).toContain("Equipe da Sua Empresa na call: Gabriel");
    for (const [k, v] of [["NEXT_PUBLIC_EMPRESA_NOME", antes.nome], ["IA_SOBRE_A_EMPRESA", antes.sobre]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  it("equipe = falas com customId membro:", () => {
    expect(equipeDaTranscricao([t("1", "x", "Gabriel", "membro:g"), t("2", "x", "Ana"), t("3", "x", "Gabriel", "membro:g"), t("4", "x", "Bento", null)])).toEqual(["Gabriel"]);
  });
});
