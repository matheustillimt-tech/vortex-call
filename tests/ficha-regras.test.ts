import { describe, expect, it } from "vitest";
import {
  extrairResumo,
  limparResumo,
  linkWhatsapp,
  listaUtm,
  montarPromptResumo,
  paraSessoesAnteriores,
  respostasDoFormulario,
  rotuloOrigem,
  rotuloSituacao,
} from "@/src/lib/regras/ficha";

describe("respostasDoFormulario", () => {
  it("objeto {pergunta: resposta}", () => {
    expect(respostasDoFormulario({ "Qual seu negócio?": "Clínica", "Faturamento?": 50000 })).toEqual([
      { pergunta: "Qual seu negócio?", resposta: "Clínica" },
      { pergunta: "Faturamento?", resposta: "50000" },
    ]);
  });

  it("lista [{pergunta, resposta}]", () => {
    expect(respostasDoFormulario([{ pergunta: "Cargo", resposta: "Dona" }, { pergunta: "Canais", resposta: ["Instagram", "Google"] }])).toEqual([
      { pergunta: "Cargo", resposta: "Dona" },
      { pergunta: "Canais", resposta: "Instagram, Google" },
    ]);
  });

  it("JSON guardado como texto também vale", () => {
    expect(respostasDoFormulario('{"Cargo":"Dona"}')).toEqual([{ pergunta: "Cargo", resposta: "Dona" }]);
  });

  it("pula vazios e itens sem pergunta ou resposta", () => {
    expect(respostasDoFormulario({ Cargo: "", Nome: null, " ": "x", Ok: true })).toEqual([{ pergunta: "Ok", resposta: "true" }]);
    expect(respostasDoFormulario([{ pergunta: "A" }, { resposta: "B" }, "solto", null])).toEqual([]);
  });

  it("nada, texto solto ou número viram lista vazia", () => {
    for (const v of [null, undefined, "", "oi", 3, []]) expect(respostasDoFormulario(v)).toEqual([]);
  });

  it("corta resposta muito longa", () => {
    const [p] = respostasDoFormulario({ Conte: "a".repeat(3000) });
    expect(p.resposta.length).toBe(2001);
    expect(p.resposta.endsWith("…")).toBe(true);
  });
});

describe("contato e origem", () => {
  it("link do WhatsApp só com dígitos", () => {
    expect(linkWhatsapp("+551137654321")).toBe("https://wa.me/551137654321");
  });
  it("rótulo da origem", () => {
    expect(rotuloOrigem("pagina")).toBe("Página de agendamento");
    expect(rotuloOrigem("encaixe")).toBe("Agendamento encaixado em outra página");
    expect(rotuloOrigem("painel")).toBe("Cadastrada pela equipe");
    expect(rotuloOrigem("outra")).toBe("outra");
  });
  it("UTMs na ordem fixa, só as preenchidas", () => {
    expect(listaUtm({ utm_campaign: "out", utm_source: "instagram", utm_term: "", outro: "x" })).toEqual([
      { rotulo: "Fonte", valor: "instagram" },
      { rotulo: "Campanha", valor: "out" },
    ]);
    expect(listaUtm(null)).toEqual([]);
    expect(listaUtm(["a"])).toEqual([]);
  });
  it("situação da inscrição como o painel", () => {
    expect(rotuloSituacao("agendado")).toBe("Agendou");
    expect(rotuloSituacao("compareceu")).toBe("Veio");
    expect(rotuloSituacao("faltou")).toBe("Faltou");
    expect(rotuloSituacao("cancelado")).toBe("Cancelou");
  });
});

describe("paraSessoesAnteriores", () => {
  it("mais recente primeiro, com agenda e situação; aceita embutido como objeto ou lista", () => {
    const r = paraSessoesAnteriores(
      [
        { status: "faltou", sessoes: { inicio: "2026-10-13T12:00:00+00:00" }, agendas: { nome: "Vendas" } },
        { status: "compareceu", sessoes: [{ inicio: "2026-10-20T12:00:00+00:00" }], agendas: [{ nome: "Mentoria" }] },
        { status: "agendado", sessoes: null, agendas: { nome: "Sem sessão" } },
      ],
      "America/Sao_Paulo",
    );
    expect(r).toEqual([
      { quando: "20/10/2026 às 09:00", agenda: "Mentoria", situacao: "Veio" },
      { quando: "13/10/2026 às 09:00", agenda: "Vendas", situacao: "Faltou" },
    ]);
  });
});

describe("resumo por IA", () => {
  it("prompt leva nome e respostas, nunca contato", () => {
    const { sistema, usuario } = montarPromptResumo({ nome: "Ana Souza", respostas: [{ pergunta: "Negócio", resposta: "Clínica" }] });
    expect(sistema).toContain("quem é a pessoa, o que ela quer e a objeção mais provável");
    expect(sistema).toContain('{"resumo": "..."}');
    expect(sistema).toContain("Não use travessão");
    expect(usuario).toBe("Nome: Ana Souza\n\nRespostas do formulário:\n- Negócio: Clínica");
  });

  it("prompt usa no máximo 40 respostas", () => {
    const respostas = Array.from({ length: 50 }, (_, i) => ({ pergunta: `P${i}`, resposta: "r" }));
    expect(montarPromptResumo({ nome: "A", respostas }).usuario.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(40);
  });

  it("limparResumo troca travessão por vírgula e junta espaços", () => {
    expect(limparResumo("  Ana — dona de clínica –  quer   agenda cheia. ")).toBe("Ana, dona de clínica, quer agenda cheia.");
    expect(limparResumo("   ")).toBeNull();
  });

  it("extrairResumo pega o campo resumo", () => {
    expect(extrairResumo({ resumo: "Ana — dona." })).toBe("Ana, dona.");
    expect(extrairResumo({ resumo: 3 })).toBeNull();
    expect(extrairResumo({})).toBeNull();
  });
});
