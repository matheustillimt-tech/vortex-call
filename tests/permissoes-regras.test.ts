import { describe, expect, it } from "vitest";
import { CHAVES_PERMISSAO, lerPermissoes, limparPermissoes, pode, PERMISSOES, PERMISSOES_PADRAO } from "@/src/lib/regras/permissoes";
import { mascararContatoFicha, mascararContatosNoTexto, mascararEmail, mascararSeContato, mascararWhatsapp } from "@/src/lib/regras/contato";

describe("permissões", () => {
  it("lista as 11 chaves com rótulo, descrição e padrão (só todas_agendas nasce desligada)", () => {
    expect(CHAVES_PERMISSAO).toEqual([
      "dashboard", "receita", "anfitriao", "espiao", "ficha", "contato_lead", "horarios", "gravacoes", "transcricao", "reunioes", "todas_agendas",
    ]);
    for (const p of PERMISSOES) {
      expect(p.rotulo.length).toBeGreaterThan(3);
      expect(p.descricao.length).toBeGreaterThan(3);
    }
    expect(Object.entries(PERMISSOES_PADRAO).filter(([, v]) => !v).map(([k]) => k)).toEqual(["todas_agendas"]);
    expect(PERMISSOES.find((p) => p.chave === "contato_lead")?.descricao).toBe("WhatsApp e e-mail completos (desligado: mascarados)");
  });

  it("lerPermissoes: valor salvo vale; faltando, não booleano ou lixo, vale o padrão; chave desconhecida some", () => {
    expect(lerPermissoes(null)).toEqual(PERMISSOES_PADRAO);
    expect(lerPermissoes("x")).toEqual(PERMISSOES_PADRAO);
    expect(lerPermissoes([true])).toEqual(PERMISSOES_PADRAO);
    const p = lerPermissoes({ receita: false, todas_agendas: true, ficha: "sim", hacker: true });
    expect(p.receita).toBe(false);
    expect(p.todas_agendas).toBe(true);
    expect(p.ficha).toBe(true);
    expect("hacker" in p).toBe(false);
  });

  it("limparPermissoes: só as chaves conhecidas com booleano; o resto fica no padrão", () => {
    expect(limparPermissoes({ gravacoes: false, outra: false, reunioes: 0 })).toEqual({ ...PERMISSOES_PADRAO, gravacoes: false });
  });

  it("pode: admin sempre; membro pelo que está salvo; sem permissões salvas, o padrão", () => {
    expect(pode({ papel: "admin", permissoes: { receita: false } }, "receita")).toBe(true);
    expect(pode({ papel: "admin" }, "todas_agendas")).toBe(true);
    expect(pode({ papel: "membro", permissoes: { receita: false } }, "receita")).toBe(false);
    expect(pode({ papel: "membro", permissoes: { receita: false } }, "dashboard")).toBe(true);
    expect(pode({ papel: "membro" }, "todas_agendas")).toBe(false);
    expect(pode({ papel: "membro" }, "anfitriao")).toBe(true);
  });
});

describe("mascarar contato", () => {
  it("WhatsApp do Brasil: DDD e o primeiro dígito, final com 4", () => {
    expect(mascararWhatsapp("+551137651234")).toBe("+55 11 3••••-1234");
    expect(mascararWhatsapp("+553134561234")).toBe("+55 31 3••••-1234");
  });
  it("WhatsApp de fora: código do país e o final", () => {
    expect(mascararWhatsapp("+14155550123")).toBe("+14 ••••-0123");
    expect(mascararWhatsapp("+351212345678")).toBe("+35 ••••-5678");
  });
  it("WhatsApp curto ou vazio", () => {
    expect(mascararWhatsapp("123")).toBe("••••");
    expect(mascararWhatsapp("")).toBe("");
  });
  it("e-mail: primeira letra e o domínio", () => {
    expect(mascararEmail("maria@exemplo.com")).toBe("m•••@exemplo.com");
    expect(mascararEmail("a@b.co")).toBe("a•••@b.co");
    expect(mascararEmail("semarroba")).toBe("•••");
    expect(mascararEmail(null)).toBeNull();
    expect(mascararEmail("")).toBeNull();
  });
  it("resposta de formulário que é contato vira máscara; o resto passa", () => {
    expect(mascararSeContato("joao@empresa.com.br")).toBe("j•••@empresa.com.br");
    expect(mascararSeContato("(11) 3765-4321")).toBe("+55 11 3••••-4321");
    expect(mascararSeContato("+55 11 3765-4321")).toBe("+55 11 3••••-4321");
    expect(mascararSeContato("Quero aumentar as vendas em 2026")).toBe("Quero aumentar as vendas em 2026");
    expect(mascararSeContato("R$ 10.000 a 50.000")).toBe("R$ 10.000 a 50.000");
    expect(mascararSeContato("50")).toBe("50");
  });
});

describe("mascararContatoFicha", () => {
  it("tira o contato inteiro e os links; o resto fica", () => {
    const f = mascararContatoFicha({
      nome: "Ana",
      whatsapp: "+551137654321",
      linkWhatsapp: "https://wa.me/551137654321",
      email: "ana@x.com",
      respostas: [{ pergunta: "E-mail", resposta: "ana@x.com" }, { pergunta: "Negócio", resposta: "Clínica" }],
    });
    expect(f).toEqual({
      nome: "Ana",
      whatsapp: "+55 11 3••••-4321",
      linkWhatsapp: "",
      email: "a•••@x.com",
      respostas: [{ pergunta: "E-mail", resposta: "a•••@x.com" }, { pergunta: "Negócio", resposta: "Clínica" }],
      contatoMascarado: true,
      observacoesTravadas: false,
    });
    expect(JSON.stringify(f)).not.toContain("987654321");
  });
});

describe("mascararContatosNoTexto", () => {
  it("mascara telefones e e-mails no meio do texto livre", () => {
    expect(mascararContatosNoTexto("Liga no (11) 3765-4321 ou manda pra joao@empresa.com.br amanhã.")).toBe(
      "Liga no +55 11 3••••-4321 ou manda pra j•••@empresa.com.br amanhã.",
    );
    expect(mascararContatosNoTexto("Zap +55 11 3765-4321, fixo 11 3456-7890")).toBe("Zap +55 11 3••••-4321, fixo +55 11 3••••-7890");
    expect(mascararContatosNoTexto("whats 551137654321")).not.toContain("987654321");
  });
  it("não mexe em datas, valores e números curtos", () => {
    const t = "Fatura R$ 12.500,00 em 23/10/2026, 3 filiais, CNPJ? não. Meta 2027.";
    expect(mascararContatosNoTexto(t)).toBe(t);
    expect(mascararContatosNoTexto("")).toBe("");
  });
});

describe("mascararContatoFicha: texto livre", () => {
  const base = { whatsapp: "+551137654321", linkWhatsapp: "x", email: null, respostas: [] };
  it("mascara o resumo da IA e as observações; com contato nas observações, trava", () => {
    const f = mascararContatoFicha({
      ...base,
      resumo: { estado: "pronto", texto: "Pediu retorno no 11 3888-7766." },
      observacoes: "Sócio: ana@x.com",
    });
    expect(f.resumo).toEqual({ estado: "pronto", texto: "Pediu retorno no +55 11 3••••-7766." });
    expect(f.observacoes).toBe("Sócio: a•••@x.com");
    expect(f.observacoesTravadas).toBe(true);
  });
  it("observações sem contato seguem editáveis", () => {
    expect(mascararContatoFicha({ ...base, observacoes: "Prefere à tarde." }).observacoesTravadas).toBe(false);
  });
});
