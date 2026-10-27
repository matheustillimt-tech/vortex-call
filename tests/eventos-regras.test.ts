import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assinarCorpo,
  deveLembrar,
  idEvento,
  minutosDePresenca,
  montarCorpo,
  proximaTentativa,
  urlValida,
} from "@/src/lib/regras/eventos";
import { formatarSessao } from "@/src/lib/regras/fuso";

describe("idEvento", () => {
  it("monta evento:inscricao:sessao", () => {
    expect(idEvento("agendou", "i1", "s1")).toBe("agendou:i1:s1");
  });
});

describe("montarCorpo", () => {
  const base = {
    inscricao: { id: "i1", codigo: "abcdefghjk", nome: "Maria Silva", whatsapp: "+551137654321", email: "maria@x.com" },
    sessao: { id: "s1", titulo: "Aula de vendas", inicio: "2026-10-28T12:00:00Z" },
    agenda: { slug: "vendas", nome: "Vendas" },
    site: "https://call.exemplo.com.br",
    agora: new Date("2026-10-26T10:00:00Z"),
  };

  it("leva as respostas do formulário em texto (uma por linha) quando tem; sem respostas, não manda o campo", () => {
    const comRespostas = montarCorpo({
      evento: "agendou",
      ...base,
      respostas: [
        { pergunta: "Qual é o nome da sua empresa?", resposta: "Loja X" },
        { pergunta: "Qual é o seu segmento?", resposta: "Moda e vestuário" },
      ],
    }) as any;
    expect(comRespostas.respostas_texto).toBe("Qual é o nome da sua empresa?: Loja X\nQual é o seu segmento?: Moda e vestuário");
    expect("respostas_texto" in (montarCorpo({ evento: "agendou", ...base }) as any)).toBe(false);
    expect("respostas_texto" in (montarCorpo({ evento: "agendou", ...base, respostas: [] }) as any)).toBe(false);
  });

  it("monta o corpo no formato do spec", () => {
    const corpo = montarCorpo({ evento: "agendou", ...base }) as any;
    expect(corpo.evento).toBe("agendou");
    expect(corpo.id_evento).toBe("agendou:i1:s1");
    expect(corpo.enviado_em).toBe(base.agora.toISOString());
    expect(corpo.agenda).toEqual({ slug: "vendas", nome: "Vendas" });
    expect(corpo.sessao.id).toBe("s1");
    expect(corpo.sessao.titulo).toBe("Aula de vendas");
    expect(corpo.sessao.inicio).toBe("2026-10-28T12:00:00Z");
    // A real formatarSessao() não produz exatamente "terça, 28/10 às 09:00" do brief: ela usa cccc (nome completo
    // do dia, ex. "quarta-feira") e 28/10/2026 cai numa quarta-feira, não terça. inicio_texto usa a saída real dela.
    expect(corpo.sessao.inicio_texto).toBe(formatarSessao(new Date("2026-10-28T12:00:00Z"), "America/Sao_Paulo"));
    expect(corpo.sessao.inicio_texto).toBe("quarta-feira, 28/10 às 09:00");
    expect(corpo.lead).toEqual({ nome: "Maria Silva", primeiro_nome: "Maria", whatsapp: "+551137654321", telefone: "551137654321", email: "maria@x.com" });
    expect(corpo.link).toBe("https://call.exemplo.com.br/c/abcdefghjk");
    expect(corpo.link_reagendar).toBe("https://call.exemplo.com.br/agendar/vendas");
    expect(corpo.minutos_na_sala).toBeUndefined();
  });

  it("minutos_na_sala só aparece em compareceu", () => {
    const comPresenca = { ...base, inscricao: { ...base.inscricao, minutos_na_sala: 42 } };
    const compareceu = montarCorpo({ evento: "compareceu", ...comPresenca }) as any;
    expect(compareceu.minutos_na_sala).toBe(42);
    const agendou = montarCorpo({ evento: "agendou", ...comPresenca }) as any;
    expect(agendou.minutos_na_sala).toBeUndefined();
  });

  it("sem minutos_na_sala na inscrição, compareceu usa 0", () => {
    const corpo = montarCorpo({ evento: "compareceu", ...base }) as any;
    expect(corpo.minutos_na_sala).toBe(0);
  });

  it("sem título da sessão cai pro nome da agenda", () => {
    const corpo = montarCorpo({ evento: "agendou", ...base, sessao: { ...base.sessao, titulo: null } }) as any;
    expect(corpo.sessao.titulo).toBe("Vendas");
  });
});

describe("proximaTentativa", () => {
  const agora = new Date("2026-10-23T10:00:00Z");
  it("1ª +1min, 2ª +5min, 3ª +15min, 4ª em diante null", () => {
    expect(proximaTentativa(1, agora)).toEqual(new Date("2026-10-23T10:01:00Z"));
    expect(proximaTentativa(2, agora)).toEqual(new Date("2026-10-23T10:05:00Z"));
    expect(proximaTentativa(3, agora)).toEqual(new Date("2026-10-23T10:15:00Z"));
    expect(proximaTentativa(4, agora)).toBeNull();
    expect(proximaTentativa(5, agora)).toBeNull();
  });
});

describe("deveLembrar", () => {
  const inicio = new Date("2026-10-28T12:00:00Z");

  it("lembrete_24h: dentro da janela e inscrito 2 dias antes → true", () => {
    expect(
      deveLembrar({ tipo: "lembrete_24h", inicio, inscritoEm: new Date("2026-10-26T12:00:00Z"), agora: new Date("2026-10-27T13:00:00Z") }),
    ).toBe(true);
  });

  it("lembrete_24h: inscrito 10h antes → false", () => {
    expect(
      deveLembrar({ tipo: "lembrete_24h", inicio, inscritoEm: new Date("2026-10-28T02:00:00Z"), agora: new Date("2026-10-27T13:00:00Z") }),
    ).toBe(false);
  });

  it("lembrete_24h: 30 min antes do início → false", () => {
    expect(
      deveLembrar({ tipo: "lembrete_24h", inicio, inscritoEm: new Date("2026-10-26T00:00:00Z"), agora: new Date("2026-10-28T11:30:00Z") }),
    ).toBe(false);
  });

  it("lembrete_1h: entre 1h e 40min do início, inscrito ontem → true", () => {
    expect(
      deveLembrar({ tipo: "lembrete_1h", inicio, inscritoEm: new Date("2026-10-27T12:00:00Z"), agora: new Date("2026-10-28T11:20:00Z") }),
    ).toBe(true);
  });

  it("lembrete_1h: inscrito 30 min antes → false", () => {
    expect(
      deveLembrar({ tipo: "lembrete_1h", inicio, inscritoEm: new Date("2026-10-28T11:30:00Z"), agora: new Date("2026-10-28T11:40:00Z") }),
    ).toBe(false);
  });

  it("lembrete_1h: depois do início → false", () => {
    expect(
      deveLembrar({ tipo: "lembrete_1h", inicio, inscritoEm: new Date("2026-10-27T12:00:00Z"), agora: new Date("2026-10-28T12:30:00Z") }),
    ).toBe(false);
  });
});

describe("assinarCorpo", () => {
  it("é sha256= + hmac hex do corpo com o segredo", () => {
    const esperado = `sha256=${createHmac("sha256", "s").update("{}").digest("hex")}`;
    expect(assinarCorpo("s", "{}")).toBe(esperado);
  });
});

describe("minutosDePresenca", () => {
  it("une intervalos sobrepostos: 10:00-10:20 e 10:15-10:40 → 40", () => {
    const minutos = minutosDePresenca(
      [
        { entrou: new Date("2026-10-23T10:00:00Z"), saiu: new Date("2026-10-23T10:20:00Z") },
        { entrou: new Date("2026-10-23T10:15:00Z"), saiu: new Date("2026-10-23T10:40:00Z") },
      ],
      new Date("2026-10-23T11:00:00Z"),
    );
    expect(minutos).toBe(40);
  });

  it("saiu nulo usa o fim", () => {
    const minutos = minutosDePresenca([{ entrou: new Date("2026-10-23T10:00:00Z"), saiu: null }], new Date("2026-10-23T10:10:00Z"));
    expect(minutos).toBe(10);
  });

  it("lista vazia → 0", () => {
    expect(minutosDePresenca([], new Date())).toBe(0);
  });

  it("intervalo aberto que começou depois do fim é ignorado → 0", () => {
    const fim = new Date("2026-10-23T11:00:00Z");
    expect(minutosDePresenca([{ entrou: new Date("2026-10-23T11:30:00Z"), saiu: null }], fim)).toBe(0);
    expect(
      minutosDePresenca(
        [
          { entrou: new Date("2026-10-23T10:00:00Z"), saiu: new Date("2026-10-23T10:10:00Z") },
          { entrou: new Date("2026-10-23T11:05:00Z"), saiu: new Date("2026-10-23T11:50:00Z") },
        ],
        fim,
      ),
    ).toBe(10);
  });

  it("intervalo fechado que passa do fim é cortado no fim", () => {
    const minutos = minutosDePresenca(
      [{ entrou: new Date("2026-10-23T10:30:00Z"), saiu: new Date("2026-10-23T12:00:00Z") }],
      new Date("2026-10-23T11:00:00Z"),
    );
    expect(minutos).toBe(30);
  });
});

describe("urlValida", () => {
  it("aceita https até 500 caracteres", () => {
    expect(urlValida("https://crm.exemplo.com/webhook")).toBe(true);
    expect(urlValida(`https://x.com/${"a".repeat(480)}`)).toBe(true);
  });

  it("recusa http, javascript:, vazio e url gigante", () => {
    expect(urlValida("http://crm.exemplo.com")).toBe(false);
    expect(urlValida("javascript:alert(1)")).toBe(false);
    expect(urlValida("")).toBe(false);
    expect(urlValida(`https://x.com/${"a".repeat(600)}`)).toBe(false);
  });
});

describe("montarCorpo do evento resumo", () => {
  it("leva resumo_texto e o JSON só no evento resumo", async () => {
    const { montarCorpo } = await import("@/src/lib/regras/eventos");
    const base = {
      inscricao: { id: "i1", codigo: "abc", nome: "Ana Souza", whatsapp: "+553239990001", email: null },
      sessao: { id: "s1", titulo: null, inicio: "2026-10-26T18:00:00.000Z" },
      agenda: { slug: "implementacao-ia", nome: "Implementação" },
      site: "https://call.x",
      agora: new Date("2026-10-26T19:00:00.000Z"),
      resumo: { texto: "RESUMO DA CALL", dados: { negocio: "Clínica" } },
    };
    const c = montarCorpo({ ...base, evento: "resumo" });
    expect(c.resumo_texto).toBe("RESUMO DA CALL");
    expect(c.resumo).toEqual({ negocio: "Clínica" });
    expect(c.id_evento).toBe("resumo:i1:s1");
    expect(montarCorpo({ ...base, evento: "compareceu" }).resumo_texto).toBeUndefined();
  });
});

describe("montarCorpo do evento comprou", () => {
  it("leva a venda com valor em reais só no evento comprou", async () => {
    const { montarCorpo } = await import("@/src/lib/regras/eventos");
    const base = {
      inscricao: { id: "i1", codigo: "abc", nome: "Ana Souza", whatsapp: "+553239990001", email: null },
      sessao: { id: "s1", titulo: null, inicio: "2026-10-26T18:00:00.000Z" },
      agenda: { slug: "implementacao-ia", nome: "Implementação" },
      site: "https://call.x",
      agora: new Date("2026-10-26T21:00:00.000Z"),
      venda: { pedido: "p1", produto: "Curso Completo", valorCentavos: 349012, compradaEm: "2026-10-26T20:57:08.584Z" },
    };
    const c = montarCorpo({ ...base, evento: "comprou" });
    expect(c.id_evento).toBe("comprou:i1:s1");
    expect(c.venda).toMatchObject({ pedido: "p1", produto: "Curso Completo", valor: "3490.12", comprada_em: "2026-10-26T20:57:08.584Z" });
    expect(String((c.venda as Record<string, unknown>).valor_texto).replace(/\s/g, " ")).toBe("R$ 3.490,12");
    expect(montarCorpo({ ...base, evento: "compareceu" }).venda).toBeUndefined();
  });
});
