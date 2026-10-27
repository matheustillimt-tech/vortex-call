import { describe, expect, it } from "vitest";
import {
  atualizarEmBreve,
  corpoEmBreve,
  corpoNovoAgendamento,
  corpoResumoDiario,
  deveAvisarEmBreve,
  diaDoResumo,
  idAvisoEquipe,
  resumoDaFicha,
} from "@/src/lib/regras/avisos-equipe";

const SITE = "https://call.exemplo.com.br";
const AGORA = new Date("2026-10-23T11:00:00Z"); // 08:00 em Brasília
const VENDEDOR = { nome: "Hugo Prado", whatsapp: "+551138887777" };
const SESSAO = { id: "s1", titulo: null, inicio: "2026-10-23T22:00:00Z" }; // 19:00 em Brasília
const AGENDA = { id: "ag1", nome: "Implementação de IA (grupo)", slug: "implementacao" };

describe("idAvisoEquipe", () => {
  it("novo agendamento por inscrição+sessão, em breve por sessão, resumo por vendedor+dia", () => {
    // Um id por agendamento (agendado_em muda a cada remarcação: A→B→A gera outro aviso), igual nas tentativas.
    expect(idAvisoEquipe({ evento: "vendedor_novo_agendamento", inscricao: "i1", sessao: "s1", agendadoEm: "2026-10-23T12:00:00.123Z" })).toBe(
      "vendedor_novo_agendamento:i1:s1:1792756800123",
    );
    expect(idAvisoEquipe({ evento: "vendedor_sessao_em_breve", sessao: "s1" })).toBe("vendedor_sessao_em_breve:s1");
    expect(idAvisoEquipe({ evento: "vendedor_resumo_diario", usuario: "u1", dia: "2026-10-23" })).toBe("vendedor_resumo_diario:u1:2026-10-23");
  });
});

describe("resumoDaFicha", () => {
  it("usa o resumo da IA (cortado), senão até 3 respostas curtas, senão null", () => {
    expect(resumoDaFicha({ resumoIa: "  Dono de clínica, quer automatizar.  ", respostas: [] })).toBe("Dono de clínica, quer automatizar.");
    expect(resumoDaFicha({ resumoIa: "a".repeat(400), respostas: [] })).toBe(`${"a".repeat(279)}…`);
    expect(
      resumoDaFicha({
        resumoIa: null,
        respostas: [
          { pergunta: "Área", resposta: "Saúde" },
          { pergunta: "Faturamento", resposta: "50 mil" },
          { pergunta: "Desafio", resposta: "x".repeat(200) },
          { pergunta: "Quarta", resposta: "fora" },
        ],
      }),
    ).toBe(`Área: Saúde\nFaturamento: 50 mil\nDesafio: ${"x".repeat(99)}…`);
    expect(resumoDaFicha({ resumoIa: null, respostas: [] })).toBeNull();
  });
});

describe("corpoNovoAgendamento", () => {
  const base = {
    vendedor: VENDEDOR,
    lead: { id: "i1", nome: "Maria Silva", whatsapp: "+551137654321", email: "maria@x.com", agendado_em: "2026-10-23T12:00:00.000Z" },
    sessao: SESSAO,
    agenda: AGENDA,
    resumo: "Área: Saúde",
    reagendou: false,
    site: SITE,
    agora: AGORA,
  };

  it("monta o payload com vendedor, mensagem fixa e dados", () => {
    const c = corpoNovoAgendamento(base);
    expect(c).toMatchObject({
      evento: "vendedor_novo_agendamento",
      id_evento: "vendedor_novo_agendamento:i1:s1:1792756800000",
      enviado_em: AGORA.toISOString(),
      vendedor: { nome: "Hugo Prado", primeiro_nome: "Hugo", telefone: "551138887777", whatsapp: "+551138887777" },
      dados: {
        reagendou: false,
        agenda: { id: "ag1", nome: "Implementação de IA (grupo)", slug: "implementacao" },
        sessao: { id: "s1", titulo: "Implementação de IA (grupo)", inicio: "2026-10-23T22:00:00Z", inicio_texto: "sexta-feira, 23/10 às 19:00" },
        lead: { nome: "Maria Silva", whatsapp: "+551137654321", email: "maria@x.com", resumo: "Área: Saúde" },
        link_anfitriao: `${SITE}/equipe/sala/s1?modo=anfitriao`,
        link_sessao: `${SITE}/sessoes/s1`,
      },
    });
    expect(c.mensagem).toBe(
      [
        'Hugo, novo agendamento na sua agenda "Implementação de IA (grupo)".',
        "",
        "Lead: Maria Silva",
        "WhatsApp: +551137654321",
        "Quando: sexta-feira, 23/10 às 19:00",
        "",
        "Sobre o lead:",
        "Área: Saúde",
        "",
        "Entrar na sala como anfitrião:",
        `${SITE}/equipe/sala/s1?modo=anfitriao`,
        "",
        "Ver a sessão no painel:",
        `${SITE}/sessoes/s1`,
      ].join("\n"),
    );
  });

  it("reagendamento muda a primeira linha; sem ficha não tem o bloco do lead", () => {
    const c = corpoNovoAgendamento({ ...base, reagendou: true, resumo: null });
    expect(c.mensagem.split("\n")[0]).toBe('Hugo, um lead reagendou pra sua agenda "Implementação de IA (grupo)".');
    expect(c.mensagem).not.toContain("Sobre o lead");
    expect(c.mensagem).not.toContain("*");
  });
});

describe("corpoEmBreve", () => {
  it("avisa a hora, os minutos que faltam e os inscritos (singular/plural)", () => {
    const agora = new Date("2026-10-23T21:50:00Z");
    const c = corpoEmBreve({ vendedor: VENDEDOR, sessao: SESSAO, agenda: AGENDA, inscritos: 5, site: SITE, agora });
    expect(c.id_evento).toBe("vendedor_sessao_em_breve:s1");
    expect(c.dados).toMatchObject({ inscritos: 5, minutos: 10, link_anfitriao: `${SITE}/equipe/sala/s1?modo=anfitriao` });
    expect(c.mensagem).toBe(
      [
        "Hugo, sua call das 19:00 começa em 10 min, 5 inscritos.",
        "Implementação de IA (grupo)",
        "",
        "Entrar na sala como anfitrião:",
        `${SITE}/equipe/sala/s1?modo=anfitriao`,
      ].join("\n"),
    );
    const um = corpoEmBreve({ vendedor: VENDEDOR, sessao: SESSAO, agenda: AGENDA, inscritos: 1, site: SITE, agora: new Date("2026-10-23T21:56:30Z") });
    expect(um.mensagem.split("\n")[0]).toBe("Hugo, sua call das 19:00 começa em 4 min, 1 inscrito.");
  });
});

describe("atualizarEmBreve (na entrega)", () => {
  it("refaz os minutos que faltam com a hora do envio", () => {
    const c = corpoEmBreve({ vendedor: VENDEDOR, sessao: SESSAO, agenda: AGENDA, inscritos: 5, site: SITE, agora: new Date("2026-10-23T21:50:00Z") });
    const depois = atualizarEmBreve(c, new Date("2026-10-23T21:57:10Z"));
    expect(depois.mensagem.split("\n")[0]).toBe("Hugo, sua call das 19:00 começa em 3 min, 5 inscritos.");
    expect(depois.mensagem.split("\n").slice(1)).toEqual(c.mensagem.split("\n").slice(1));
    expect(depois.dados.minutos).toBe(3);
  });
});

describe("corpoResumoDiario", () => {
  it("lista as calls do dia com hora, inscritos e o link de cada uma", () => {
    const c = corpoResumoDiario({
      vendedor: { id: "u1", ...VENDEDOR },
      dia: "2026-10-23",
      sessoes: [
        { id: "s2", titulo: "Turma B", inicio: "2026-10-24T00:00:00Z", agenda: "Implementação de IA (grupo)", inscritos: 1 },
        { id: "s1", titulo: null, inicio: "2026-10-23T22:00:00Z", agenda: "Implementação de IA (grupo)", inscritos: 5 },
      ],
      site: SITE,
      agora: AGORA,
    });
    expect(c.id_evento).toBe("vendedor_resumo_diario:u1:2026-10-23");
    expect(c.dados).toMatchObject({ dia: "2026-10-23", dia_texto: "sexta-feira, 23/10", total_sessoes: 2, total_inscritos: 6 });
    expect((c.dados.sessoes as { id: string }[]).map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(c.mensagem).toBe(
      [
        "Bom dia, Hugo! Suas calls de hoje (sexta-feira, 23/10):",
        "",
        "19:00 · Implementação de IA (grupo) · 5 inscritos",
        `${SITE}/equipe/sala/s1?modo=anfitriao`,
        "",
        "21:00 · Turma B · 1 inscrito",
        `${SITE}/equipe/sala/s2?modo=anfitriao`,
        "",
        "Todas as sessões no painel:",
        `${SITE}/sessoes`,
      ].join("\n"),
    );
  });
});

describe("janelas", () => {
  it("em breve: dos 10 min antes até o início", () => {
    const inicio = new Date("2026-10-23T22:00:00Z");
    expect(deveAvisarEmBreve(inicio, new Date("2026-10-23T21:49:59Z"))).toBe(false);
    expect(deveAvisarEmBreve(inicio, new Date("2026-10-23T21:50:00Z"))).toBe(true);
    expect(deveAvisarEmBreve(inicio, new Date("2026-10-23T21:59:59Z"))).toBe(true);
    expect(deveAvisarEmBreve(inicio, inicio)).toBe(false);
  });

  it("resumo diário: das 08:00 às 09:59 em Brasília, com o dia de hoje", () => {
    expect(diaDoResumo(new Date("2026-10-23T10:59:00Z"))).toBeNull(); // 07:59
    expect(diaDoResumo(new Date("2026-10-23T11:00:00Z"))).toEqual({
      dia: "2026-10-23", de: new Date("2026-10-23T03:00:00Z"), ate: new Date("2026-10-24T03:00:00Z"),
    });
    expect(diaDoResumo(new Date("2026-10-23T12:59:00Z"))?.dia).toBe("2026-10-23"); // 09:59
    expect(diaDoResumo(new Date("2026-10-23T13:00:00Z"))).toBeNull(); // 10:00
  });
});
