import { describe, expect, it } from "vitest";
import {
  barrasAgrupadas,
  caminhoLinha,
  corDaNota,
  diasDoIntervalo,
  duracaoDaRetencao,
  etapasFunil,
  filtrosDashboardDe,
  formatarAntecedencia,
  formatarMinutosMedios,
  indicadoresVendedor,
  formatarPercentual,
  formatarReais,
  intervaloDoPeriodo,
  leadNaSessao,
  marcasEixo,
  minutosDoLead,
  queryDosFiltros,
  rotuloCurtoSessao,
  sessaoDaRetencao,
  ultimasSessoesCronologicas,
} from "@/src/lib/regras/dashboard";

const UUID = "11111111-2222-4333-8444-555555555555";
const UUID2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("filtrosDashboardDe", () => {
  it("padrão é 30d sem agenda nem sessão", () => {
    expect(filtrosDashboardDe({})).toEqual({ periodo: "30d", de: null, ate: null, agenda: null, sessao: null, vendedor: null });
  });

  it("aceita os períodos válidos e ids uuid; descarta o resto", () => {
    expect(filtrosDashboardDe({ periodo: "7d", agenda: UUID, sessao: "x' or 1=1" })).toEqual({
      periodo: "7d", de: null, ate: null, agenda: UUID, sessao: null, vendedor: null,
    });
    expect(filtrosDashboardDe({ vendedor: UUID2 }).vendedor).toBe(UUID2);
    expect(filtrosDashboardDe({ vendedor: "hugo" }).vendedor).toBeNull();
    expect(filtrosDashboardDe({ periodo: "ano" }).periodo).toBe("30d");
    expect(filtrosDashboardDe({ periodo: ["hoje"] }).periodo).toBe("30d");
  });

  it("personalizado guarda as datas válidas (YYYY-MM-DD) e cai em 30d sem a de início", () => {
    expect(filtrosDashboardDe({ periodo: "personalizado", de: "2026-10-01", ate: "2026-10-10" })).toMatchObject({
      periodo: "personalizado", de: "2026-10-01", ate: "2026-10-10",
    });
    expect(filtrosDashboardDe({ periodo: "personalizado", de: "2026-02-31" }).periodo).toBe("30d");
    expect(filtrosDashboardDe({ periodo: "personalizado" }).periodo).toBe("30d");
  });
});

describe("intervaloDoPeriodo (Brasília)", () => {
  // 2026-10-23T02:30Z = 22/10 23:30 em Brasília.
  const agora = new Date("2026-10-23T02:30:00Z");
  const f = (p: Partial<ReturnType<typeof filtrosDashboardDe>>) => ({ periodo: "30d" as const, de: null, ate: null, agenda: null, sessao: null, vendedor: null, ...p });

  it("hoje = meia-noite de Brasília até a meia-noite seguinte", () => {
    expect(intervaloDoPeriodo(f({ periodo: "hoje" }), agora)).toEqual({
      de: new Date("2026-10-22T03:00:00Z"), ate: new Date("2026-10-23T03:00:00Z"),
    });
  });

  it("7d, 30d e 90d contam o dia de hoje", () => {
    expect(intervaloDoPeriodo(f({ periodo: "7d" }), agora).de).toEqual(new Date("2026-10-16T03:00:00Z"));
    expect(intervaloDoPeriodo(f({ periodo: "30d" }), agora).de).toEqual(new Date("2026-09-23T03:00:00Z"));
    expect(intervaloDoPeriodo(f({ periodo: "90d" }), agora).de).toEqual(new Date("2026-07-25T03:00:00Z"));
    expect(intervaloDoPeriodo(f({ periodo: "90d" }), agora).ate).toEqual(new Date("2026-10-23T03:00:00Z"));
  });

  it("personalizado vai do início do dia `de` ao fim do dia `ate` (inclusive), invertendo se vier trocado", () => {
    expect(intervaloDoPeriodo(f({ periodo: "personalizado", de: "2026-10-01", ate: "2026-10-10" }), agora)).toEqual({
      de: new Date("2026-10-01T03:00:00Z"), ate: new Date("2026-10-11T03:00:00Z"),
    });
    expect(intervaloDoPeriodo(f({ periodo: "personalizado", de: "2026-10-10", ate: "2026-10-01" }), agora)).toEqual({
      de: new Date("2026-10-01T03:00:00Z"), ate: new Date("2026-10-11T03:00:00Z"),
    });
    // Sem `ate`: até o fim de hoje.
    expect(intervaloDoPeriodo(f({ periodo: "personalizado", de: "2026-10-01" }), agora).ate).toEqual(new Date("2026-10-23T03:00:00Z"));
  });
});

describe("queryDosFiltros", () => {
  it("só põe o que difere do padrão", () => {
    expect(queryDosFiltros({ periodo: "30d", de: null, ate: null, agenda: null, sessao: null, vendedor: null })).toBe("");
    expect(queryDosFiltros({ periodo: "7d", de: null, ate: null, agenda: UUID, sessao: UUID2, vendedor: null })).toBe(`?periodo=7d&agenda=${UUID}&sessao=${UUID2}`);
    expect(queryDosFiltros({ periodo: "30d", de: null, ate: null, agenda: null, sessao: null, vendedor: UUID })).toBe(`?vendedor=${UUID}`);
    expect(queryDosFiltros({ periodo: "personalizado", de: "2026-10-01", ate: "2026-10-02", agenda: null, sessao: null, vendedor: null })).toBe(
      "?periodo=personalizado&de=2026-10-01&ate=2026-10-02",
    );
  });
});

describe("formatação", () => {
  it("formatarReais", () => {
    expect(formatarReais(0)).toBe("R$ 0,00");
    expect(formatarReais(99)).toBe("R$ 0,99");
    expect(formatarReais(123456789)).toBe("R$ 1.234.567,89");
    expect(formatarReais(199700)).toBe("R$ 1.997,00");
  });

  it("formatarPercentual: inteiro, uma casa abaixo de 10%, travessão sem base", () => {
    expect(formatarPercentual(1, 2)).toBe("50%");
    expect(formatarPercentual(1, 3)).toBe("33%");
    expect(formatarPercentual(1, 30)).toBe("3,3%");
    expect(formatarPercentual(0, 10)).toBe("0%");
    expect(formatarPercentual(5, 0)).toBe("—");
  });

  it("formatarPercentual nunca passa de 100% (parte maior que o total trava em 100%)", () => {
    expect(formatarPercentual(10, 10)).toBe("100%");
    expect(formatarPercentual(12, 10)).toBe("100%");
  });

  it("formatarMinutosMedios", () => {
    expect(formatarMinutosMedios(12.5)).toBe("12,5 min");
    expect(formatarMinutosMedios(40)).toBe("40 min");
    expect(formatarMinutosMedios(0)).toBe("—");
  });

  it("corDaNota: <30 erro, 30 a 60 aviso, >60 ok", () => {
    expect(corDaNota(29.9)).toBe("erro");
    expect(corDaNota(30)).toBe("aviso");
    expect(corDaNota(60)).toBe("aviso");
    expect(corDaNota(60.1)).toBe("ok");
  });
});

describe("etapasFunil", () => {
  it("Vieram sobre os inscritos; as etapas depois sobre quem veio (não são aninhadas); a primeira sem %", () => {
    const e = etapasFunil({ inscritos: 100, vieram: 40, ficaram_ate_fim: 20, interagiram: 30, compraram: 4 });
    expect(e.map((x) => [x.rotulo, x.valor, x.percentual, x.sobre])).toEqual([
      ["Inscritos", 100, null, null],
      ["Vieram", 40, "40%", "dos inscritos"],
      ["Interagiram", 30, "75%", "de quem veio"],
      ["Compraram", 4, "10%", "de quem veio"],
    ]);
    expect(etapasFunil({ inscritos: 0, vieram: 0, ficaram_ate_fim: 0, interagiram: 0, compraram: 0 })[1].percentual).toBe("—");
  });

  it("ficaram até o fim não aparece mais no funil", () => {
    const e = etapasFunil({ inscritos: 50, vieram: 20, ficaram_ate_fim: 5, interagiram: 15, compraram: 2 });
    expect(e.map((x) => x.chave)).toEqual(["inscritos", "vieram", "interagiram", "compraram"]);
    expect(e[2].percentual).toBe("75%");
  });

  it("dado inconsistente (compraram maior que vieram): trava em 100%", () => {
    const e = etapasFunil({ inscritos: 10, vieram: 3, ficaram_ate_fim: 3, interagiram: 3, compraram: 5 });
    expect(e[3].percentual).toBe("100%");
  });
});

describe("escalas e geometria", () => {
  it("marcasEixo arredonda o máximo pra um número redondo", () => {
    expect(marcasEixo(0)).toEqual([0, 1]);
    expect(marcasEixo(1)).toEqual([0, 1]);
    expect(marcasEixo(3)).toEqual([0, 1, 2, 3]);
    expect(marcasEixo(7)).toEqual([0, 2, 4, 6, 8]);
    expect(marcasEixo(10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(marcasEixo(37)).toEqual([0, 10, 20, 30, 40]);
    expect(marcasEixo(100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(marcasEixo(230)).toEqual([0, 50, 100, 150, 200, 250]);
  });

  it("barrasAgrupadas divide a largura em grupos com espaço e barras lado a lado", () => {
    const g = barrasAgrupadas({ grupos: 2, series: 2, largura: 200, folga: 0.2 });
    expect(g).toHaveLength(2);
    expect(g[0].centro).toBe(50);
    expect(g[1].centro).toBe(150);
    // Banda de 100, 20% de folga = 80 úteis, 40 por barra.
    expect(g[0].barras).toEqual([{ x: 10, largura: 40 }, { x: 50, largura: 40 }]);
    expect(barrasAgrupadas({ grupos: 0, series: 2, largura: 200 })).toEqual([]);
  });

  it("caminhoLinha monta o path SVG", () => {
    expect(caminhoLinha([])).toBe("");
    expect(caminhoLinha([{ x: 0, y: 10 }, { x: 5.123, y: 2 }])).toBe("M0,10 L5.12,2");
  });

  it("duracaoDaRetencao: a série vai de 0 até duração + 30", () => {
    expect(duracaoDaRetencao(Array.from({ length: 91 }, (_, m) => ({ minuto: m, presentes: 0 })))).toBe(60);
    expect(duracaoDaRetencao([])).toBeNull();
  });
});

describe("sessões dos gráficos", () => {
  const s = (id: string, inicio: string, vieram = 0) => ({ id, inicio, vieram });

  it("ultimasSessoesCronologicas pega as N mais recentes em ordem de data", () => {
    const lista = [s("c", "2026-10-03T00:00:00Z"), s("b", "2026-10-02T00:00:00Z"), s("a", "2026-10-01T00:00:00Z")];
    expect(ultimasSessoesCronologicas(lista, 2).map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("sessaoDaRetencao: a do filtro, senão a mais recente que já passou com alguém presente", () => {
    const lista = [s("futura", "2026-10-30T00:00:00Z", 0), s("b", "2026-10-02T00:00:00Z", 3), s("a", "2026-10-01T00:00:00Z", 5)];
    expect(sessaoDaRetencao(lista, "a")).toBe("a");
    expect(sessaoDaRetencao(lista, null)).toBe("b");
    expect(sessaoDaRetencao([s("x", "2026-10-01T00:00:00Z", 0)], null)).toBeNull();
  });
});

describe("minutosDoLead (mesma regra do SQL dashboard_linhas)", () => {
  const inicio = new Date("2026-10-20T22:00:00Z");
  const base = { inicio, duracaoMin: 60, agora: new Date("2026-10-23T00:00:00Z"), minutosNaSala: 7 };

  it("sem presença usa o minutos_na_sala gravado", () => {
    expect(minutosDoLead({ ...base, presencas: [] })).toBe(7);
  });

  it("corta antes do início e depois da janela (início + duração + 2 h); une sobrepostas", () => {
    const presencas = [
      { entrou_em: "2026-10-20T21:50:00Z", saiu_em: "2026-10-20T22:20:00Z" }, // 10 min antes não contam: 20
      { entrou_em: "2026-10-20T22:10:00Z", saiu_em: "2026-10-20T22:30:00Z" }, // sobrepõe: +10
      { entrou_em: "2026-10-21T00:50:00Z", saiu_em: null }, // aberta: até 01:00 (janela) = +10
      { entrou_em: "2026-10-21T02:00:00Z", saiu_em: null }, // depois da janela: ignorada
    ];
    expect(minutosDoLead({ ...base, presencas })).toBe(40);
  });

  it("sessão ainda na janela corta em agora", () => {
    const presencas = [{ entrou_em: "2026-10-20T22:00:00Z", saiu_em: null }];
    expect(minutosDoLead({ ...base, agora: new Date("2026-10-20T22:15:30Z"), presencas })).toBe(15);
  });
});

describe("leadNaSessao (detalhe e painel da sessão)", () => {
  const inicio = new Date("2026-10-20T22:00:00Z");
  const base = { inicio, duracaoMin: 60, agora: new Date("2026-10-23T00:00:00Z"), minutosNaSala: null, atividade: undefined };
  const atividade = { mic_s: 120, cam_s: 1800, msgs: 5 };

  it("agendado com presença (antes da avaliação): veio, minutos cortados no início, nota calculada", () => {
    const presencas = [{ entrou_em: "2026-10-20T21:30:00Z", saiu_em: "2026-10-20T22:30:00Z" }];
    expect(leadNaSessao({ ...base, status: "agendado", presencas })).toEqual({ veio: true, minutos: 30, nota: 20 });
  });

  it("minutos_na_sala sem corte não muda a nota quando há presença (usa a presença)", () => {
    const presencas = [{ entrou_em: "2026-10-20T21:00:00Z", saiu_em: "2026-10-20T23:00:00Z" }];
    expect(leadNaSessao({ ...base, status: "compareceu", minutosNaSala: 120, presencas, atividade })).toEqual({ veio: true, minutos: 60, nota: 100 });
  });

  it("compareceu marcado à mão, sem presença: usa minutos_na_sala", () => {
    expect(leadNaSessao({ ...base, status: "compareceu", minutosNaSala: 30, presencas: [] })).toEqual({ veio: true, minutos: 30, nota: 20 });
  });

  it("quem não veio (agendado/faltou sem presença) e cancelado: nota null (a tela mostra —)", () => {
    expect(leadNaSessao({ ...base, status: "agendado", presencas: [], atividade })).toEqual({ veio: false, minutos: 0, nota: null });
    expect(leadNaSessao({ ...base, status: "faltou", presencas: [] }).nota).toBeNull();
    const presencas = [{ entrou_em: "2026-10-20T22:00:00Z", saiu_em: "2026-10-20T22:30:00Z" }];
    expect(leadNaSessao({ ...base, status: "cancelado", presencas }).nota).toBeNull();
  });
});

describe("diasDoIntervalo e rotuloCurtoSessao", () => {
  it("volta pros dias de Brasília, com o fim inclusivo", () => {
    expect(diasDoIntervalo({ de: new Date("2026-10-01T03:00:00Z"), ate: new Date("2026-10-11T03:00:00Z") })).toEqual({ de: "2026-10-01", ate: "2026-10-10" });
  });
  it("rótulo curto em Brasília", () => {
    expect(rotuloCurtoSessao("2026-10-22T22:00:00Z")).toBe("22/10 19:00");
  });
});

describe("vendedores", () => {
  it("formatarAntecedencia: antes, na hora, atrasado e sem dado", () => {
    expect(formatarAntecedencia(5)).toBe("5 min antes");
    expect(formatarAntecedencia(2.5)).toBe("2,5 min antes");
    expect(formatarAntecedencia(0)).toBe("na hora");
    expect(formatarAntecedencia(-3)).toBe("3 min atrasado");
    expect(formatarAntecedencia(null)).toBe("—");
  });

  it("indicadoresVendedor: comparecimento, conversão sobre quem veio e ticket médio, com travessão sem base", () => {
    expect(indicadoresVendedor({ inscritos: 10, vieram: 4, compraram: 1, receita_centavos: 199700 })).toEqual({
      comparecimento: "40%",
      conversao: "25%",
      ticket: "R$ 1.997,00",
    });
    expect(indicadoresVendedor({ inscritos: 0, vieram: 0, compraram: 0, receita_centavos: 0 })).toEqual({ comparecimento: "—", conversao: "—", ticket: "—" });
    // Dado inconsistente (comprou sem ter vindo) não passa de 100%.
    expect(indicadoresVendedor({ inscritos: 2, vieram: 1, compraram: 2, receita_centavos: 1000 }).conversao).toBe("100%");
  });
});
