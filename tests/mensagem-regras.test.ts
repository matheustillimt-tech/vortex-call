import { describe, expect, it } from "vitest";
import {
  contextoDaFicha,
  corpoParaEnvio,
  dadosDoCorpo,
  extrairMensagem,
  linksObrigatorios,
  mensagemPadrao,
  montarCampos,
  montarPromptMensagem,
  nomeDaCall,
  validarMensagem,
  type DadosMensagem,
} from "@/src/lib/regras/mensagem";
import { EVENTOS } from "@/src/lib/regras/eventos-nomes";

const SITE = "https://call.exemplo.com.br";
const DADOS: DadosMensagem = {
  primeiroNome: "Maria",
  agenda: "Diagnóstico",
  inicioTexto: "quarta-feira, 28/10 às 09:00",
  link: `${SITE}/c/abcdefghjk`,
  linkReagendar: `${SITE}/agendar/diagnostico`,
};

const CORPO = {
  evento: "lembrete_1h",
  id_evento: "lembrete_1h:insc1:sess1",
  enviado_em: "2026-10-28T11:05:00.000Z",
  agenda: { slug: "diagnostico", nome: "Diagnóstico" },
  sessao: { id: "sess1", titulo: "Diagnóstico", inicio: "2026-10-28T12:00:00Z", inicio_texto: "quarta-feira, 28/10 às 09:00" },
  lead: { nome: "Maria Souza", primeiro_nome: "Maria", whatsapp: "+551137654321", telefone: "551137654321", email: null },
  link: `${SITE}/c/abcdefghjk`,
  link_reagendar: `${SITE}/agendar/diagnostico`,
};

describe("dadosDoCorpo", () => {
  it("tira do corpo enfileirado o que a mensagem precisa", () => {
    expect(dadosDoCorpo(CORPO)).toEqual(DADOS);
  });

  it("corpo incompleto (evento velho ou estranho) vira texto vazio, sem lançar", () => {
    expect(dadosDoCorpo({ a: 1 })).toEqual({ primeiroNome: "", agenda: "", inicioTexto: "", link: "", linkReagendar: "" });
  });
});

describe("nomeDaCall", () => {
  const DIAG = { nome: "diagnóstico", seu: "seu", pro: "pro", marcado: "marcado" };
  const APRES = { nome: "apresentação", seu: "sua", pro: "pra", marcado: "marcada" };

  it("agenda com apresentação no nome (com ou sem acento, qualquer caixa) vira apresentação", () => {
    expect(nomeDaCall("Consultoria — apresentação")).toEqual(APRES);
    expect(nomeDaCall("APRESENTACAO do produto")).toEqual(APRES);
    expect(nomeDaCall("Apresentaçao")).toEqual(APRES);
  });

  it("qualquer outra agenda vira diagnóstico (nunca call de vendas)", () => {
    expect(nomeDaCall("Call de vendas")).toEqual(DIAG);
    expect(nomeDaCall("Diagnóstico")).toEqual(DIAG);
    expect(nomeDaCall("")).toEqual(DIAG);
  });
});

describe("montarCampos", () => {
  it("campos planos pro contato do CRM", () => {
    expect(montarCampos("lembrete_1h", DADOS)).toEqual({
      call_agenda: "diagnóstico",
      call_horario: "quarta-feira, 28/10 às 09:00",
      call_link: `${SITE}/c/abcdefghjk`,
      call_reagendar: `${SITE}/agendar/diagnostico`,
      call_status: "lembrete",
    });
  });

  it("call_agenda é o nome pro lead, não o nome interno da agenda", () => {
    expect(montarCampos("agendou", { ...DADOS, agenda: "Call de vendas" }).call_agenda).toBe("diagnóstico");
    expect(montarCampos("agendou", { ...DADOS, agenda: "Consultoria — apresentação" }).call_agenda).toBe("apresentação");
  });

  it("status em português por evento", () => {
    const status = EVENTOS.map((e) => montarCampos(e, DADOS).call_status);
    expect(status).toEqual(["agendado", "lembrete", "lembrete", "começou", "faltou", "compareceu", "compareceu", "comprou"]);
  });
});

describe("linksObrigatorios", () => {
  it("sala no agendou, nos lembretes e no começou; reagendar só no faltou; nada no compareceu", () => {
    expect(linksObrigatorios("agendou", DADOS)).toEqual([DADOS.link]);
    expect(linksObrigatorios("lembrete_24h", DADOS)).toEqual([DADOS.link]);
    expect(linksObrigatorios("lembrete_1h", DADOS)).toEqual([DADOS.link]);
    expect(linksObrigatorios("comecou", DADOS)).toEqual([DADOS.link]);
    expect(linksObrigatorios("faltou", DADOS)).toEqual([DADOS.linkReagendar]);
    expect(linksObrigatorios("compareceu", DADOS)).toEqual([]);
  });
});

describe("mensagemPadrao", () => {
  it("compareceu não manda nada", () => {
    expect(mensagemPadrao("compareceu", DADOS)).toBe("");
  });

  it("cada evento leva os links certos e o nome", () => {
    for (const e of EVENTOS.filter((x) => x !== "compareceu" && x !== "resumo" && x !== "comprou")) {
      const texto = mensagemPadrao(e, DADOS);
      expect(texto).toContain("Maria");
      for (const link of linksObrigatorios(e, DADOS)) expect(texto).toContain(link);
      expect(texto.length).toBeLessThanOrEqual(600);
      expect(texto).not.toMatch(/[—–]/);
    }
  });

  it("agendou e lembrete 1 dia citam o horário", () => {
    expect(mensagemPadrao("agendou", DADOS)).toContain("quarta-feira, 28/10 às 09:00");
    expect(mensagemPadrao("lembrete_24h", DADOS)).toContain("quarta-feira, 28/10 às 09:00");
  });

  it("textos fixos do guia", () => {
    expect(mensagemPadrao("agendou", DADOS)).toBe(
      `Prontinho, Maria! Seu diagnóstico ficou marcado pra quarta-feira, 28/10 às 09:00.\n\nLink pra entrar: ${DADOS.link}`,
    );
    expect(mensagemPadrao("lembrete_24h", DADOS)).toBe(
      `Oi, Maria! Passando pra lembrar: seu diagnóstico é quarta-feira, 28/10 às 09:00. Guarda o link pra entrar: ${DADOS.link}`,
    );
    expect(mensagemPadrao("lembrete_1h", DADOS)).toBe(
      `Maria, falta menos de 1 hora pro seu diagnóstico! Entra pelo link na hora certa: ${DADOS.link}`,
    );
    expect(mensagemPadrao("comecou", DADOS)).toBe(`Seu diagnóstico está começando agora, Maria! Entra pelo link: ${DADOS.link}`);
  });

  it("agenda de apresentação: nome e palavras no feminino", () => {
    const ap = { ...DADOS, agenda: "Consultoria — apresentação" };
    expect(mensagemPadrao("agendou", ap)).toBe(
      `Prontinho, Maria! Sua apresentação ficou marcada pra quarta-feira, 28/10 às 09:00.\n\nLink pra entrar: ${DADOS.link}`,
    );
    expect(mensagemPadrao("lembrete_24h", ap)).toContain("Passando pra lembrar: sua apresentação é quarta-feira");
    expect(mensagemPadrao("lembrete_1h", ap)).toBe(
      `Maria, falta menos de 1 hora pra sua apresentação! Entra pelo link na hora certa: ${DADOS.link}`,
    );
    expect(mensagemPadrao("comecou", ap)).toBe(`Sua apresentação está começando agora, Maria! Entra pelo link: ${DADOS.link}`);
    for (const e of EVENTOS) expect(mensagemPadrao(e, ap)).not.toMatch(/diagnóstico|Consultoria/);
  });

  it("sem primeiro nome, a frase continua natural", () => {
    const sem = { ...DADOS, primeiroNome: "" };
    expect(mensagemPadrao("comecou", sem)).toBe(`Seu diagnóstico está começando agora! Entra pelo link: ${DADOS.link}`);
    expect(mensagemPadrao("lembrete_1h", sem)).toBe(`Falta menos de 1 hora pro seu diagnóstico! Entra pelo link na hora certa: ${DADOS.link}`);
    for (const e of EVENTOS) expect(mensagemPadrao(e, sem)).not.toMatch(/ ,|^,|, !|,,/);
  });
});

describe("validarMensagem", () => {
  const links = [DADOS.link];

  it("aceita texto com o link exato e devolve limpo", () => {
    expect(validarMensagem(`  Oi Maria! Entra aqui: ${DADOS.link}  `, links)).toBe(`Oi Maria! Entra aqui: ${DADOS.link}`);
  });

  it("recusa sem o link exato", () => {
    expect(validarMensagem("Oi Maria! Entra aqui: https://call.exemplo.com.br/c/outro", links)).toBeNull();
  });

  it("recusa acima de 600 caracteres", () => {
    expect(validarMensagem(`${"a".repeat(600)} ${DADOS.link}`, links)).toBeNull();
  });

  it("recusa vazio e preço", () => {
    expect(validarMensagem("   ", [])).toBeNull();
    expect(validarMensagem(`Só R$ 97 hoje! ${DADOS.link}`, links)).toBeNull();
  });

  it("recusa a palavra venda no texto, mas aceita vendas dentro do link", () => {
    expect(validarMensagem(`A sala da nossa call de vendas abriu! ${DADOS.link}`, links)).toBeNull();
    const reagendar = "https://call.exemplo.com.br/agendar/vendas";
    expect(validarMensagem(`Escolhe outro horário:\n${reagendar}`, [reagendar])).toBe(`Escolhe outro horário:\n${reagendar}`);
  });

  it("tira markdown de negrito e travessão sem mexer no link", () => {
    expect(validarMensagem(`**Oi** Maria — entra: ${DADOS.link}`, links)).toBe(`Oi Maria, entra: ${DADOS.link}`);
  });

  it("mantém quebra de linha simples", () => {
    expect(validarMensagem(`Oi Maria!\n\n\n\nEntra: ${DADOS.link}`, links)).toBe(`Oi Maria!\n\nEntra: ${DADOS.link}`);
  });
});

describe("extrairMensagem", () => {
  it("pega o campo mensagem e valida", () => {
    expect(extrairMensagem({ mensagem: `Oi! ${DADOS.link}` }, [DADOS.link])).toBe(`Oi! ${DADOS.link}`);
    expect(extrairMensagem({ texto: `Oi! ${DADOS.link}` }, [DADOS.link])).toBeNull();
    expect(extrairMensagem({ mensagem: 42 }, [])).toBeNull();
  });
});

describe("contextoDaFicha", () => {
  it("prefere o resumo da IA, cortado", () => {
    const r = contextoDaFicha("x".repeat(1000), [{ pergunta: "p", resposta: "r" }]);
    expect(r).not.toBeNull();
    expect(r!.length).toBeLessThanOrEqual(401);
    expect(r!.startsWith("xxx")).toBe(true);
  });

  it("sem resumo, usa poucas respostas curtas", () => {
    const respostas = Array.from({ length: 10 }, (_, i) => ({ pergunta: `Pergunta ${i}`, resposta: "y".repeat(500) }));
    const r = contextoDaFicha(null, respostas)!;
    expect(r).toContain("Pergunta 0");
    expect(r).not.toContain("Pergunta 5");
    expect(r.length).toBeLessThanOrEqual(1000);
  });

  it("sem nada, null", () => {
    expect(contextoDaFicha(null, [])).toBeNull();
    expect(contextoDaFicha("  ", [])).toBeNull();
  });
});

describe("montarPromptMensagem", () => {
  it("leva evento, nome, agenda, horário e os links; nunca WhatsApp", () => {
    const { sistema, usuario } = montarPromptMensagem("lembrete_1h", DADOS, "Dona de clínica, quer mais pacientes.");
    expect(sistema).toContain("JSON");
    expect(sistema).toContain('"mensagem"');
    expect(usuario).toContain("Maria");
    expect(usuario).toContain("Nome da call (use sempre este): diagnóstico");
    expect(usuario).toContain("quarta-feira, 28/10 às 09:00");
    expect(usuario).toContain(DADOS.link);
    expect(usuario).toContain("Dona de clínica");
    expect(usuario).not.toContain("551137654321");
  });

  it("faltou pede o link de reagendar, não o da sala", () => {
    const { usuario } = montarPromptMensagem("faltou", DADOS, null);
    expect(usuario).toContain(DADOS.linkReagendar);
    expect(usuario).not.toContain(DADOS.link);
    expect(usuario).not.toContain("Sobre a pessoa");
  });

  it("nunca leva o nome interno da agenda, só o nome pro lead", () => {
    for (const agenda of ["Call de vendas", "Consultoria — apresentação"]) {
      const { usuario } = montarPromptMensagem("agendou", { ...DADOS, agenda }, null);
      expect(usuario).not.toContain(agenda);
      expect(usuario).not.toMatch(/vendas|Consultoria/);
      expect(usuario).toContain(`Nome da call (use sempre este): ${nomeDaCall(agenda).nome}`);
    }
  });

  it("sistema proíbe a palavra venda e manda usar o nome indicado", () => {
    const { sistema } = montarPromptMensagem("comecou", DADOS, null);
    expect(sistema).toMatch(/Não use a palavra venda/);
    expect(sistema).toMatch(/nome indicado/);
  });

  it("agendou pede só o link da sala", () => {
    const { usuario } = montarPromptMensagem("agendou", DADOS, null);
    expect(usuario).toContain(DADOS.link);
    expect(usuario).not.toContain(DADOS.linkReagendar);
  });
});

describe("corpoParaEnvio", () => {
  it("acrescenta campos e mensagem sem mexer no resto", () => {
    const final = corpoParaEnvio("lembrete_1h", CORPO, "Oi Maria!");
    expect(final).toEqual({ ...CORPO, campos: montarCampos("lembrete_1h", DADOS), mensagem: "Oi Maria!" });
    expect(CORPO).not.toHaveProperty("mensagem");
  });
});

describe("evento resumo", () => {
  it("não manda mensagem pro lead nem pede link", () => {
    expect(mensagemPadrao("resumo", DADOS)).toBe("");
    expect(linksObrigatorios("resumo", DADOS)).toEqual([]);
  });
});

describe("evento comprou", () => {
  it("não manda mensagem pro lead nem pede link", () => {
    expect(mensagemPadrao("comprou", DADOS)).toBe("");
    expect(linksObrigatorios("comprou", DADOS)).toEqual([]);
  });
});
