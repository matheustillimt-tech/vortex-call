import { beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;
const listas: Record<string, Linha[]> = {};
const consultas: { tabela: string; filtros: unknown[][] }[] = [];
const updates: { tabela: string; valores: Linha; filtros: unknown[][] }[] = [];
const errosUpdate: Record<string, unknown> = {};
const errosLeitura: Record<string, unknown> = {};
const updateSemLinhas: Record<string, boolean> = {};
/** Ordem global de enfileirar/update (pra conferir quem veio antes). */
const ordem: string[] = [];

/** Fake do PostgREST: aplica eq/in/neq/is de verdade (o resto só registra); update devolve { error }. */
function consulta(tabela: string) {
  const filtros: unknown[][] = [];
  consultas.push({ tabela, filtros });
  const aplicar = () => {
    const linhas = (listas[tabela] ?? []).filter((l) =>
      filtros.every(([op, col, val]) => {
        if (op === "eq") return l[col as string] === val;
        if (op === "in") return (val as unknown[]).includes(l[col as string]);
        if (op === "neq") return l[col as string] !== val;
        if (op === "is") return (l[col as string] ?? null) === val;
        return true;
      }),
    );
    const range = filtros.find(([op]) => op === "range");
    return range ? linhas.slice(range[1] as number, (range[2] as number) + 1) : linhas;
  };
  const q: Record<string, unknown> = {};
  for (const op of ["eq", "in", "neq", "is", "gt", "lte", "gte", "lt", "or", "order", "range"]) {
    q[op] = (...a: unknown[]) => {
      filtros.push([op, ...a]);
      return q;
    };
  }
  q.select = () => q;
  q.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(errosLeitura[tabela] ? { data: null, error: errosLeitura[tabela] } : { data: aplicar(), error: null }).then(ok, falha);
  q.update = (valores: Linha) => {
    const fu: unknown[][] = [];
    updates.push({ tabela, valores, filtros: fu });
    ordem.push(`update:${tabela}`);
    const r: Record<string, unknown> = {
      eq: (...a: unknown[]) => {
        fu.push(["eq", ...a]);
        return r;
      },
      select: () => r,
      then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => {
        const erro = errosUpdate[tabela] ?? null;
        // Linhas que casam com os filtros do update (o fake não muda a lista; o código só olha se veio alguma).
        const linhas = erro
          ? null
          : updateSemLinhas[tabela]
          ? []
          : (listas[tabela] ?? []).filter((l) => fu.every(([, col, val]) => l[col as string] === val)).map((l) => ({ id: l.id }));
        return Promise.resolve({ data: linhas, error: erro }).then(ok, falha);
      },
    };
    return r;
  };
  return q;
}
const rpcs: { nome: string; args: unknown }[] = [];
const errosRpc: Record<string, unknown> = {};
vi.mock("@/src/lib/supabase/admin", () => ({
  dbAdmin: () => ({
    from: (t: string) => consulta(t),
    rpc: (nome: string, args: unknown) => {
      rpcs.push({ nome, args });
      return Promise.resolve({ data: errosRpc[nome] ? null : 0, error: errosRpc[nome] ?? null });
    },
  }),
}));

type OpcoesEnfileirar = { minutosNaSala?: number };
const enfileirar = vi.fn<(evento: string, inscricaoId: string, agora?: Date, opcoes?: OpcoesEnfileirar) => Promise<boolean>>();
vi.mock("@/src/lib/eventos", () => ({
  enfileirar: (...a: [string, string, Date?, OpcoesEnfileirar?]) => {
    ordem.push(`enfileirar:${a[1]}`);
    return enfileirar(...a);
  },
}));
const avisarCompra = vi.fn(async (_db: unknown, _filtro: unknown) => undefined);
vi.mock("@/src/lib/vendas", () => ({ avisarCompra: (db: unknown, filtro: unknown) => avisarCompra(db, filtro) }));

const AGORA = new Date("2026-10-23T12:00:00Z");
const MIN = 60_000;
const HORA = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  avisarCompra.mockClear();
  for (const k of Object.keys(listas)) delete listas[k];
  for (const k of Object.keys(errosUpdate)) delete errosUpdate[k];
  for (const k of Object.keys(errosLeitura)) delete errosLeitura[k];
  for (const k of Object.keys(updateSemLinhas)) delete updateSemLinhas[k];
  for (const k of Object.keys(errosRpc)) delete errosRpc[k];
  rpcs.length = 0;
  consultas.length = 0;
  updates.length = 0;
  ordem.length = 0;
  enfileirar.mockReset();
  enfileirar.mockResolvedValue(true);
});

describe("enfileirarComecou", () => {
  it("enfileira comecou só para inscrições agendado da sessão sem presença", async () => {
    listas.inscricoes = [
      { id: "i1", sessao_id: "s1", status: "agendado" },
      { id: "i2", sessao_id: "s1", status: "agendado" },
      { id: "i3", sessao_id: "s1", status: "cancelado" },
      { id: "i4", sessao_id: "s2", status: "agendado" },
    ];
    listas.presencas = [{ sessao_id: "s1", inscricao_id: "i2" }];
    const { enfileirarComecou } = await import("@/src/lib/disparos");
    const n = await enfileirarComecou("s1", AGORA);
    expect(n).toBe(1);
    expect(enfileirar).toHaveBeenCalledTimes(1);
    expect(enfileirar).toHaveBeenCalledWith("comecou", "i1", AGORA);
  });

  it("falha numa inscrição não impede as outras", async () => {
    listas.inscricoes = [
      { id: "i1", sessao_id: "s1", status: "agendado" },
      { id: "i2", sessao_id: "s1", status: "agendado" },
    ];
    enfileirar.mockRejectedValueOnce(new Error("órfã"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { enfileirarComecou } = await import("@/src/lib/disparos");
    const n = await enfileirarComecou("s1", AGORA);
    expect(n).toBe(1);
    expect(enfileirar).toHaveBeenCalledTimes(2);
    erro.mockRestore();
  });
});

describe("enfileirarComecou: fila", () => {
  it("não enfileira de novo quem já tem o comecou na fila", async () => {
    listas.inscricoes = [
      { id: "i1", sessao_id: "s1", status: "agendado" },
      { id: "i2", sessao_id: "s1", status: "agendado" },
    ];
    listas.eventos = [{ sessao_id: "s1", inscricao_id: "i1", evento: "comecou" }];
    const { enfileirarComecou } = await import("@/src/lib/disparos");
    expect(await enfileirarComecou("s1", AGORA)).toBe(1);
    expect(enfileirar).toHaveBeenCalledWith("comecou", "i2", AGORA);
  });
});

describe("enfileirarComecouNaHora", () => {
  it("busca sessões agendadas/ao vivo com início entre 10 min atrás e agora e avisa cada uma", async () => {
    listas.sessoes = [
      { id: "s1", status: "agendada" },
      { id: "s2", status: "ao_vivo" },
      { id: "s3", status: "cancelada" },
    ];
    listas.inscricoes = [
      { id: "i1", sessao_id: "s1", status: "agendado" },
      { id: "i2", sessao_id: "s2", status: "agendado" },
      { id: "i3", sessao_id: "s3", status: "agendado" },
    ];
    const { enfileirarComecouNaHora } = await import("@/src/lib/disparos");
    expect(await enfileirarComecouNaHora(AGORA)).toBe(2);
    expect(enfileirar).toHaveBeenCalledWith("comecou", "i1", AGORA);
    expect(enfileirar).toHaveBeenCalledWith("comecou", "i2", AGORA);
    const q = consultas.find((c) => c.tabela === "sessoes")!;
    expect(q.filtros).toContainEqual(["in", "status", ["agendada", "ao_vivo"]]);
    expect(q.filtros).toContainEqual(["lte", "inicio", AGORA.toISOString()]);
    expect(q.filtros).toContainEqual(["gt", "inicio", iso(AGORA.getTime() - 10 * MIN)]);
  });

  it("erro numa sessão não impede as outras", async () => {
    listas.sessoes = [{ id: "s1", status: "agendada" }, { id: "s2", status: "agendada" }];
    listas.inscricoes = [
      { id: "i1", sessao_id: "s1", status: "agendado" },
      { id: "i2", sessao_id: "s2", status: "agendado" },
    ];
    errosLeitura.presencas = { message: "fora" };
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { enfileirarComecouNaHora } = await import("@/src/lib/disparos");
    expect(await enfileirarComecouNaHora(AGORA)).toBe(0);
    expect(erro).toHaveBeenCalledTimes(2);
    erro.mockRestore();
  });
});

describe("enfileirarLembretes", () => {
  it("lembrete_24h e lembrete_1h nas janelas certas, só para agendado inscrito a tempo", async () => {
    const inicioA = AGORA.getTime() + 20 * HORA; // janela do 24h
    const inicioB = AGORA.getTime() + 30 * MIN; // janela do 1h
    listas.sessoes = [
      { id: "sA", inicio: iso(inicioA), status: "agendada" },
      { id: "sB", inicio: iso(inicioB), status: "ao_vivo" },
    ];
    listas.inscricoes = [
      { id: "a1", sessao_id: "sA", status: "agendado", agendado_em: iso(inicioA - 48 * HORA) },
      { id: "a2", sessao_id: "sA", status: "agendado", agendado_em: iso(inicioA - 22 * HORA) }, // tarde demais pro 24h
      { id: "a3", sessao_id: "sA", status: "cancelado", agendado_em: iso(inicioA - 48 * HORA) },
      { id: "b1", sessao_id: "sB", status: "agendado", agendado_em: iso(inicioB - 2 * HORA) },
      { id: "b2", sessao_id: "sB", status: "agendado", agendado_em: iso(inicioB - 40 * MIN) }, // tarde demais pro 1h
    ];
    const { enfileirarLembretes } = await import("@/src/lib/disparos");
    const n = await enfileirarLembretes(AGORA);
    expect(n).toBe(2);
    expect(enfileirar.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["lembrete_24h", "a1"],
      ["lembrete_1h", "b1"],
    ]);
    // uma consulta pras sessões e uma pras inscrições (sem N+1)
    expect(consultas.filter((c) => c.tabela === "sessoes")).toHaveLength(1);
    expect(consultas.filter((c) => c.tabela === "inscricoes")).toHaveLength(1);
    const qSessoes = consultas.find((c) => c.tabela === "sessoes")!;
    expect(qSessoes.filtros).toContainEqual(["in", "status", ["agendada", "ao_vivo"]]);
    expect(qSessoes.filtros).toContainEqual(["gt", "inicio", AGORA.toISOString()]);
    expect(qSessoes.filtros).toContainEqual(["lte", "inicio", iso(AGORA.getTime() + 24 * HORA)]);
  });

  it("não reenfileira lembrete que já está na fila", async () => {
    const inicio = AGORA.getTime() + 20 * HORA;
    listas.sessoes = [{ id: "sA", inicio: iso(inicio), status: "agendada" }];
    listas.inscricoes = [{ id: "a1", sessao_id: "sA", status: "agendado", agendado_em: iso(inicio - 48 * HORA) }];
    listas.eventos = [{ id_evento: "lembrete_24h:a1:sA", evento: "lembrete_24h", sessao_id: "sA" }];
    const { enfileirarLembretes } = await import("@/src/lib/disparos");
    expect(await enfileirarLembretes(AGORA)).toBe(0);
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it("sem sessões na janela não consulta inscrições", async () => {
    const { enfileirarLembretes } = await import("@/src/lib/disparos");
    expect(await enfileirarLembretes(AGORA)).toBe(0);
    expect(consultas.filter((c) => c.tabela === "inscricoes")).toHaveLength(0);
  });

  it("enfileirar que devolve false (já existia) não conta", async () => {
    const inicio = AGORA.getTime() + 20 * HORA;
    listas.sessoes = [{ id: "sA", inicio: iso(inicio), status: "agendada" }];
    listas.inscricoes = [{ id: "a1", sessao_id: "sA", status: "agendado", agendado_em: iso(inicio - 48 * HORA) }];
    enfileirar.mockResolvedValue(false);
    const { enfileirarLembretes } = await import("@/src/lib/disparos");
    expect(await enfileirarLembretes(AGORA)).toBe(0);
  });
});

describe("avaliarSessoes", () => {
  function sessao(id: string, inicioMs: number, status: string, duracao = 60) {
    return { id, inicio: iso(inicioMs), status, avaliada_em: null, agendas: { duracao_min: duracao } };
  }

  it("sessão ao_vivo que passou do prazo final: compareceu com minutos e faltou; marca avaliada_em", async () => {
    const inicio = AGORA.getTime() - 4 * HORA; // prazo final = inicio + 60 + 120 = 1 h atrás
    listas.sessoes = [sessao("s1", inicio, "ao_vivo")];
    listas.inscricoes = [
      { id: "i1", sessao_id: "s1", status: "agendado" },
      { id: "i2", sessao_id: "s1", status: "agendado" },
      { id: "i3", sessao_id: "s1", status: "cancelado" },
    ];
    listas.presencas = [
      { sessao_id: "s1", inscricao_id: "i1", entrou_em: iso(inicio), saiu_em: iso(inicio + 20 * MIN) },
      { sessao_id: "s1", inscricao_id: "i1", entrou_em: iso(inicio + 40 * MIN), saiu_em: iso(inicio + 60 * MIN) },
    ];
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    const n = await avaliarSessoes(AGORA);
    expect(n).toBe(1);

    const upInsc = updates.filter((u) => u.tabela === "inscricoes");
    expect(upInsc).toHaveLength(2);
    expect(upInsc[0]).toEqual({ tabela: "inscricoes", valores: { status: "compareceu", minutos_na_sala: 40 }, filtros: [["eq", "id", "i1"], ["eq", "sessao_id", "s1"], ["eq", "status", "agendado"]] });
    expect(upInsc[1]).toEqual({ tabela: "inscricoes", valores: { status: "faltou" }, filtros: [["eq", "id", "i2"], ["eq", "sessao_id", "s1"], ["eq", "status", "agendado"]] });

    expect(enfileirar.mock.calls).toEqual([
      ["compareceu", "i1", AGORA, { minutosNaSala: 40 }],
      ["faltou", "i2", AGORA, {}],
    ]);
    // Enfileira ANTES de gravar a inscrição (se a fila falhar, a inscrição continua agendado pro próximo tick).
    expect(ordem).toEqual(["enfileirar:i1", "update:inscricoes", "enfileirar:i2", "update:inscricoes", "update:sessoes"]);
    const upSess = updates.filter((u) => u.tabela === "sessoes");
    expect(upSess).toEqual([{ tabela: "sessoes", valores: { avaliada_em: AGORA.toISOString() }, filtros: [["eq", "id", "s1"]] }]);
  });

  it("sessão encerrada antes do fim é avaliada já, com fim = agora", async () => {
    const inicio = AGORA.getTime() - 10 * MIN; // ainda dentro da duração
    listas.sessoes = [sessao("s1", inicio, "encerrada")];
    listas.inscricoes = [{ id: "i1", sessao_id: "s1", status: "agendado" }];
    listas.presencas = [{ sessao_id: "s1", inscricao_id: "i1", entrou_em: iso(inicio), saiu_em: null }];
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(1);
    expect(updates.find((u) => u.tabela === "inscricoes")!.valores).toEqual({ status: "compareceu", minutos_na_sala: 10 });
  });

  it("sessão encerrada muito depois: fim limitado a início + duração + 120 min", async () => {
    const inicio = AGORA.getTime() - 10 * HORA;
    listas.sessoes = [sessao("s1", inicio, "encerrada", 60)];
    listas.inscricoes = [{ id: "i1", sessao_id: "s1", status: "agendado" }];
    listas.presencas = [{ sessao_id: "s1", inscricao_id: "i1", entrou_em: iso(inicio), saiu_em: null }];
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    await avaliarSessoes(AGORA);
    expect(updates.find((u) => u.tabela === "inscricoes")!.valores).toEqual({ status: "compareceu", minutos_na_sala: 180 });
  });

  it("sessão ao_vivo sem presença aberta: fim = prazo final (início + duração + 120 min)", async () => {
    const inicio = AGORA.getTime() - 5 * HORA;
    listas.sessoes = [sessao("s1", inicio, "ao_vivo", 60)];
    listas.inscricoes = [{ id: "i1", sessao_id: "s1", status: "agendado" }];
    listas.presencas = [{ sessao_id: "s1", inscricao_id: "i1", entrou_em: iso(inicio), saiu_em: null }];
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(1);
    expect(updates.find((u) => u.tabela === "inscricoes")!.valores).toEqual({ status: "compareceu", minutos_na_sala: 180 });
  });

  it("sessão ao_vivo depois do fim programado mas antes do prazo final ainda não é avaliada", async () => {
    listas.sessoes = [sessao("s1", AGORA.getTime() - 90 * MIN, "ao_vivo", 60)]; // fim 30 min atrás, prazo em 90 min
    listas.inscricoes = [{ id: "i1", sessao_id: "s1", status: "agendado" }];
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(0);
    expect(updates).toHaveLength(0);
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it("sessão agendada que o anfitrião nunca abriu: marca avaliada_em sem mexer nas inscrições nem enfileirar", async () => {
    listas.sessoes = [{ ...sessao("s1", AGORA.getTime() - 90 * MIN, "agendada", 60), aberta_em: null }];
    listas.inscricoes = [{ id: "i1", sessao_id: "s1", status: "agendado" }];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(1);
    expect(updates).toEqual([{ tabela: "sessoes", valores: { avaliada_em: AGORA.toISOString() }, filtros: [["eq", "id", "s1"]] }]);
    expect(enfileirar).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[crm] sessão nunca aberta, sem avaliação", "s1");
    log.mockRestore();
  });

  it("sessão agendada nunca aberta ainda dentro da duração: nada acontece", async () => {
    listas.sessoes = [{ ...sessao("s1", AGORA.getTime() - 30 * MIN, "agendada", 60), aberta_em: null }];
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("sessão ainda dentro da duração e não encerrada não é avaliada", async () => {
    listas.sessoes = [sessao("s1", AGORA.getTime() - 30 * MIN, "ao_vivo", 60)];
    listas.inscricoes = [{ id: "i1", sessao_id: "s1", status: "agendado" }];
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(0);
    expect(updates).toHaveLength(0);
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it("consulta só sessões não avaliadas e não canceladas", async () => {
    listas.sessoes = [
      sessao("s1", AGORA.getTime() - 3 * HORA, "cancelada"),
      { ...sessao("s2", AGORA.getTime() - 3 * HORA, "encerrada"), avaliada_em: AGORA.toISOString() },
    ];
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(0);
    const q = consultas.find((c) => c.tabela === "sessoes")!;
    expect(q.filtros).toContainEqual(["is", "avaliada_em", null]);
    expect(q.filtros).toContainEqual(["neq", "status", "cancelada"]);
  });

  it("falha ao enfileirar: essa inscrição fica agendado, as outras seguem e a sessão não é marcada", async () => {
    listas.sessoes = [sessao("s1", AGORA.getTime() - 3 * HORA, "encerrada")];
    listas.inscricoes = [
      { id: "i1", sessao_id: "s1", status: "agendado" },
      { id: "i2", sessao_id: "s1", status: "agendado" },
    ];
    enfileirar.mockRejectedValueOnce(new Error("fila fora do ar"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(0);
    expect(enfileirar).toHaveBeenCalledTimes(2);
    const upInsc = updates.filter((u) => u.tabela === "inscricoes");
    expect(upInsc).toHaveLength(1);
    expect(upInsc[0].filtros).toContainEqual(["eq", "id", "i2"]);
    expect(updates.filter((u) => u.tabela === "sessoes")).toHaveLength(0);
    erro.mockRestore();
  });

  it("enfileirar devolve false (evento já estava na fila): grava a inscrição mesmo assim", async () => {
    listas.sessoes = [sessao("s1", AGORA.getTime() - 3 * HORA, "encerrada")];
    listas.inscricoes = [{ id: "i1", sessao_id: "s1", status: "agendado" }];
    enfileirar.mockResolvedValue(false);
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(1);
    expect(updates.filter((u) => u.tabela === "inscricoes")).toHaveLength(1);
  });

  it("falha ao atualizar a inscrição: não marca avaliada_em (tenta de novo no próximo tick)", async () => {
    listas.sessoes = [sessao("s1", AGORA.getTime() - 3 * HORA, "encerrada")];
    listas.inscricoes = [{ id: "i1", sessao_id: "s1", status: "agendado" }];
    errosUpdate.inscricoes = { message: "falhou" };
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(0);
    expect(updates.filter((u) => u.tabela === "sessoes")).toHaveLength(0);
    erro.mockRestore();
  });

  it("falha ao marcar a sessão: loga e segue pra próxima", async () => {
    listas.sessoes = [sessao("s1", AGORA.getTime() - 3 * HORA, "encerrada"), sessao("s2", AGORA.getTime() - 3 * HORA, "encerrada")];
    errosUpdate.sessoes = { message: "falhou" };
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(0);
    expect(updates.filter((u) => u.tabela === "sessoes")).toHaveLength(2);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});

describe("avaliarSessoes: correções", () => {
  function sessao(id: string, inicioMs: number, status: string, agendas: unknown = { duracao_min: 60 }) {
    return { id, inicio: iso(inicioMs), status, avaliada_em: null, agendas };
  }

  it("presença que só começou depois do fim conta como faltou", async () => {
    const inicio = AGORA.getTime() - 4 * HORA; // prazo final (fim usado) = inicio + 180 = 1 h atrás
    listas.sessoes = [sessao("s1", inicio, "ao_vivo")];
    listas.inscricoes = [{ id: "i1", sessao_id: "s1", status: "agendado" }];
    listas.presencas = [{ sessao_id: "s1", inscricao_id: "i1", entrou_em: iso(inicio + 190 * MIN), saiu_em: null }];
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(1);
    expect(updates.find((u) => u.tabela === "inscricoes")!.valores).toEqual({ status: "faltou" });
    expect(enfileirar).toHaveBeenCalledWith("faltou", "i1", AGORA, {});
  });

  it("update que não mudou nenhuma linha (já não está agendado): segue sem erro e a sessão é marcada", async () => {
    listas.sessoes = [sessao("s1", AGORA.getTime() - 3 * HORA, "encerrada")];
    listas.inscricoes = [{ id: "i1", sessao_id: "s1", status: "agendado" }];
    updateSemLinhas.inscricoes = true; // cancelada entre a leitura e o update
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(1);
    expect(updates.filter((u) => u.tabela === "inscricoes")).toHaveLength(1);
  });

  it("sessão sem agenda/duração é pulada (log) e não é marcada", async () => {
    listas.sessoes = [sessao("s1", AGORA.getTime() - 3 * HORA, "encerrada", null)];
    listas.inscricoes = [{ id: "i1", sessao_id: "s1", status: "agendado" }];
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(0);
    expect(updates).toHaveLength(0);
    expect(enfileirar).not.toHaveBeenCalled();
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});

describe("avaliarSessoes: vendas sem vínculo", () => {
  function sessao(id: string, inicioMs: number) {
    return { id, inicio: iso(inicioMs), status: "encerrada", avaliada_em: null, agendas: { duracao_min: 60 } };
  }

  it("quem vira compareceu tem as vendas sem vínculo religadas; quem faltou, não", async () => {
    const inicio = AGORA.getTime() - 3 * HORA;
    listas.sessoes = [sessao("s1", inicio)];
    listas.inscricoes = [
      { id: "i1", sessao_id: "s1", status: "agendado" },
      { id: "i2", sessao_id: "s1", status: "agendado" },
    ];
    listas.presencas = [{ sessao_id: "s1", inscricao_id: "i1", entrou_em: iso(inicio), saiu_em: iso(inicio + 30 * MIN) }];
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(1);
    expect(rpcs).toEqual([{ nome: "religar_vendas", args: { p_inscricao: "i1" } }]);
    // depois de religar, o aviso de compra (evento comprou) só pra quem veio
    expect(avisarCompra.mock.calls.map((c) => c[1])).toEqual([{ inscricaoId: "i1" }]);
  });

  it("update que não mudou a linha (já não estava agendado): não religa", async () => {
    const inicio = AGORA.getTime() - 3 * HORA;
    listas.sessoes = [sessao("s1", inicio)];
    listas.inscricoes = [{ id: "i1", sessao_id: "s1", status: "agendado" }];
    listas.presencas = [{ sessao_id: "s1", inscricao_id: "i1", entrou_em: iso(inicio), saiu_em: null }];
    updateSemLinhas.inscricoes = true;
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    await avaliarSessoes(AGORA);
    expect(rpcs).toEqual([]);
  });

  it("falha ao religar: só loga e a sessão é marcada mesmo assim", async () => {
    const inicio = AGORA.getTime() - 3 * HORA;
    listas.sessoes = [sessao("s1", inicio)];
    listas.inscricoes = [{ id: "i1", sessao_id: "s1", status: "agendado" }];
    listas.presencas = [{ sessao_id: "s1", inscricao_id: "i1", entrou_em: iso(inicio), saiu_em: null }];
    errosRpc.religar_vendas = { message: "falhou" };
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { avaliarSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarSessoes(AGORA)).toBe(1);
    expect(erro).toHaveBeenCalledWith("[crm] não religou as vendas da inscrição", "i1", "falhou");
    erro.mockRestore();
  });
});

describe("enfileirarLembretes: agendado_em e paginação", () => {
  it("usa agendado_em (reagendou perto da hora não recebe o 24h), não created_at", async () => {
    const inicio = AGORA.getTime() + 20 * HORA;
    listas.sessoes = [{ id: "sA", inicio: iso(inicio), status: "agendada" }];
    listas.inscricoes = [
      { id: "a1", sessao_id: "sA", status: "agendado", created_at: iso(inicio - 10 * 24 * HORA), agendado_em: iso(inicio - 21 * HORA) },
    ];
    const { enfileirarLembretes } = await import("@/src/lib/disparos");
    expect(await enfileirarLembretes(AGORA)).toBe(0);
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it("lê as inscrições em páginas de 1000", async () => {
    const inicio = AGORA.getTime() + 20 * HORA;
    listas.sessoes = [{ id: "sA", inicio: iso(inicio), status: "agendada" }];
    listas.inscricoes = Array.from({ length: 1500 }, (_, i) => ({
      id: `a${i}`, sessao_id: "sA", status: "agendado", agendado_em: iso(inicio - 48 * HORA),
    }));
    const { enfileirarLembretes } = await import("@/src/lib/disparos");
    expect(await enfileirarLembretes(AGORA)).toBe(1500);
    const qs = consultas.filter((c) => c.tabela === "inscricoes");
    expect(qs).toHaveLength(2);
    expect(qs[0].filtros).toContainEqual(["range", 0, 999]);
    expect(qs[1].filtros).toContainEqual(["range", 1000, 1999]);
  });

  it("lê os lembretes já na fila em páginas de 1000 (o da 2ª página não é refeito)", async () => {
    const inicio = AGORA.getTime() + 20 * HORA;
    listas.sessoes = [{ id: "sA", inicio: iso(inicio), status: "agendada" }];
    listas.inscricoes = Array.from({ length: 1001 }, (_, i) => ({
      id: `a${i}`, sessao_id: "sA", status: "agendado", agendado_em: iso(inicio - 48 * HORA),
    }));
    listas.eventos = listas.inscricoes.map((i) => ({ id_evento: `lembrete_24h:${i.id}:sA`, evento: "lembrete_24h", sessao_id: "sA" }));
    const { enfileirarLembretes } = await import("@/src/lib/disparos");
    expect(await enfileirarLembretes(AGORA)).toBe(0);
    expect(enfileirar).not.toHaveBeenCalled();
    const qs = consultas.filter((c) => c.tabela === "eventos");
    expect(qs).toHaveLength(2);
    expect(qs[1].filtros).toContainEqual(["range", 1000, 1999]);
  });
});

describe("enfileirarLembretes: erro ao ler a fila", () => {
  it("loga aviso e segue (o id_evento único ainda evita repetição)", async () => {
    const inicio = AGORA.getTime() + 20 * HORA;
    listas.sessoes = [{ id: "sA", inicio: iso(inicio), status: "agendada" }];
    listas.inscricoes = [{ id: "a1", sessao_id: "sA", status: "agendado", agendado_em: iso(inicio - 48 * HORA) }];
    errosLeitura.eventos = { message: "fora do ar" };
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { enfileirarLembretes } = await import("@/src/lib/disparos");
    expect(await enfileirarLembretes(AGORA)).toBe(1);
    expect(aviso).toHaveBeenCalledWith("[crm] não leu a fila de lembretes", "fora do ar");
    aviso.mockRestore();
  });
});
