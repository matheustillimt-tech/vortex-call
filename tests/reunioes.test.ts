import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
const update = vi.fn();
const upsert = vi.fn();
const filtros = vi.fn();
const tabelas: Record<string, Record<string, unknown> | null> = {};
const listas: Record<string, Record<string, unknown>[]> = {};
let errosInsert: ({ code?: string; message?: string } | null)[] = [];
let erroAtualizar: unknown = null;

function consulta(tabela: string) {
  const q = {
    select: () => q,
    eq: (...a: unknown[]) => (filtros(tabela, "eq", ...a), q),
    is: (...a: unknown[]) => (filtros(tabela, "is", ...a), q),
    lte: (...a: unknown[]) => (filtros(tabela, "lte", ...a), q),
    maybeSingle: async () => ({ data: tabelas[tabela] ?? null }),
    then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
      Promise.resolve({ data: listas[tabela] ?? [], error: null }).then(ok, falha),
    insert: (v: unknown) => {
      insert(tabela, v);
      return Promise.resolve({ error: errosInsert.shift() ?? null });
    },
    update: (v: unknown) => {
      update(tabela, v);
      const r = {
        eq: (...a: unknown[]) => (filtros(tabela, "update.eq", ...a), r),
        is: (...a: unknown[]) => (filtros(tabela, "update.is", ...a), r),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: erroAtualizar }).then(ok),
      };
      return r;
    },
    upsert: (v: unknown, o: unknown) => {
      upsert(tabela, v, o);
      return Promise.resolve({ error: null });
    },
  };
  return q;
}
const from = vi.fn((tabela: string) => consulta(tabela));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from }) }));

const criarMeeting = vi.fn();
const adicionarParticipante = vi.fn();
const expulsar = vi.fn();
const expulsarTodos = vi.fn();
const excluirParticipante = vi.fn();
const desativarMeeting = vi.fn();
class ErroRtkFake extends Error {
  constructor(public status: number, public corpo: unknown) {
    super(`RealtimeKit respondeu ${status}`);
  }
}
vi.mock("@/src/lib/realtimekit", () => ({
  criarMeeting: (...a: unknown[]) => criarMeeting(...a),
  adicionarParticipante: (...a: unknown[]) => adicionarParticipante(...a),
  expulsar: (...a: unknown[]) => expulsar(...a),
  expulsarTodos: (...a: unknown[]) => expulsarTodos(...a),
  excluirParticipante: (...a: unknown[]) => excluirParticipante(...a),
  desativarMeeting: (...a: unknown[]) => desativarMeeting(...a),
  ErroRtk: ErroRtkFake,
}));

const FUTURO = () => new Date(Date.now() + 3600_000).toISOString();
const PASSADO = () => new Date(Date.now() - 1000).toISOString();
const MEMBRO = { id: "memb1", nome: "Bento" };
const VISITANTE = "0f8fad5b-d9cb-469f-a165-70867728950e";
// sha256 hex do VISITANTE, primeiros 32: o uuid do navegador (segredo do visitante) nunca vai pros outros da sala.
const VISITANTE_HASH = "c812e1edb64417d6090dcfbaf16c21cd";

beforeEach(() => {
  for (const k of Object.keys(tabelas)) delete tabelas[k];
  for (const k of Object.keys(listas)) delete listas[k];
  errosInsert = [];
  erroAtualizar = null;
  for (const f of [insert, update, upsert, filtros, criarMeeting, adicionarParticipante, expulsar, expulsarTodos, excluirParticipante, desativarMeeting]) f.mockReset();
  from.mockClear();
  adicionarParticipante.mockResolvedValue({ id: "p1", token: "tok" });
  criarMeeting.mockResolvedValue({ id: "m-nova" });
});

describe("criarReuniao", () => {
  it("cria a meeting sem gravar sozinha e guarda a reunião com 24 h de validade", async () => {
    const { criarReuniao } = await import("@/src/lib/reunioes");
    const antes = Date.now();
    const r = await criarReuniao(MEMBRO, "  Alinhamento  ");

    expect(r.codigo).toMatch(/^[a-z0-9]{10}$/);
    expect(criarMeeting).toHaveBeenCalledWith({ titulo: "Alinhamento" });
    expect(insert).toHaveBeenCalledTimes(1);
    const [tabela, linha] = insert.mock.calls[0] as [string, Record<string, string>];
    expect(tabela).toBe("reunioes");
    expect(linha).toMatchObject({ codigo: r.codigo, titulo: "Alinhamento", criada_por: "memb1", rtk_meeting_id: "m-nova" });
    const expira = new Date(linha.expira_em).getTime() - antes;
    expect(expira).toBeGreaterThanOrEqual(24 * 3600_000);
    expect(expira).toBeLessThan(24 * 3600_000 + 5000);
  });

  it("sem título usa 'Reunião rápida'", async () => {
    const { criarReuniao } = await import("@/src/lib/reunioes");
    await criarReuniao(MEMBRO);
    expect(criarMeeting).toHaveBeenCalledWith({ titulo: "Reunião rápida" });
    expect(insert.mock.calls[0][1]).toMatchObject({ titulo: "Reunião rápida" });
  });

  it("código repetido (23505) tenta de novo com outro código, sem criar outra meeting", async () => {
    errosInsert = [{ code: "23505" }];
    const { criarReuniao } = await import("@/src/lib/reunioes");
    const r = await criarReuniao(MEMBRO);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(criarMeeting).toHaveBeenCalledTimes(1);
    expect((insert.mock.calls[1][1] as { codigo: string }).codigo).toBe(r.codigo);
  });

  it("outro erro do banco rejeita", async () => {
    errosInsert = [{ code: "XX000", message: "falhou" }];
    const { criarReuniao } = await import("@/src/lib/reunioes");
    await expect(criarReuniao(MEMBRO)).rejects.toThrow();
  });

  it("RealtimeKit falhando não grava nada", async () => {
    criarMeeting.mockRejectedValue(new ErroRtkFake(500, {}));
    const { criarReuniao } = await import("@/src/lib/reunioes");
    await expect(criarReuniao(MEMBRO)).rejects.toBeInstanceOf(ErroRtkFake);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("estadoReuniao", () => {
  it("código inválido não consulta o banco", async () => {
    const { estadoReuniao } = await import("@/src/lib/reunioes");
    expect(await estadoReuniao("formato-errado")).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
  it("inexistente devolve null", async () => {
    const { estadoReuniao } = await import("@/src/lib/reunioes");
    expect(await estadoReuniao("abcdefghjk")).toBeNull();
  });
  it("ativa, encerrada e vencida (vencida conta como encerrada), só com título", async () => {
    const { estadoReuniao } = await import("@/src/lib/reunioes");
    tabelas.reunioes = { id: "r1", titulo: "Alinhamento", encerrada_em: null, expira_em: FUTURO(), rtk_meeting_id: "m1" };
    expect(await estadoReuniao("abcdefghjk")).toEqual({ estado: "ativa", titulo: "Alinhamento" });
    tabelas.reunioes = { id: "r1", titulo: "Alinhamento", encerrada_em: PASSADO(), expira_em: FUTURO(), rtk_meeting_id: "m1" };
    expect(await estadoReuniao("abcdefghjk")).toEqual({ estado: "encerrada", titulo: "Alinhamento" });
    tabelas.reunioes = { id: "r1", titulo: "Alinhamento", encerrada_em: null, expira_em: PASSADO(), rtk_meeting_id: "m1" };
    expect(await estadoReuniao("abcdefghjk")).toEqual({ estado: "encerrada", titulo: "Alinhamento" });
  });
});

describe("passeReuniaoMembro", () => {
  it("anfitrião com customId membro:<id>, expulsa antes de adicionar", async () => {
    tabelas.reunioes = { id: "r1", titulo: "T", encerrada_em: null, expira_em: FUTURO(), rtk_meeting_id: "m1" };
    const { passeReuniaoMembro } = await import("@/src/lib/reunioes");
    const p = await passeReuniaoMembro("abcdefghjk", MEMBRO);

    expect(p).toEqual({ token: "tok", nome: "Bento", papel: "anfitriao" });
    expect(expulsar).toHaveBeenCalledWith("m1", ["membro:memb1"]);
    expect(adicionarParticipante).toHaveBeenCalledWith("m1", { nome: "Bento", preset: "vortex_anfitriao", customId: "membro:memb1" });
    expect(expulsar.mock.invocationCallOrder[0]).toBeLessThan(adicionarParticipante.mock.invocationCallOrder[0]);
  });

  it("segundo passe apaga o participante anterior (uma presença por pessoa)", async () => {
    tabelas.reunioes = { id: "r1", titulo: "T", encerrada_em: null, expira_em: FUTURO(), rtk_meeting_id: "m1" };
    tabelas.passes_rtk = { participant_id: "p-velho" };
    const { passeReuniaoMembro } = await import("@/src/lib/reunioes");
    await passeReuniaoMembro("abcdefghjk", MEMBRO);
    expect(upsert).toHaveBeenCalledWith("passes_rtk", expect.objectContaining({ custom_id: "membro:memb1", meeting_id: "m1", participant_id: "p1" }), { onConflict: "custom_id,meeting_id" });
    expect(excluirParticipante).toHaveBeenCalledWith("m1", "p-velho");
  });
});

describe("passeReuniaoVisitante", () => {
  it("preset vortex_participante, customId visitante:<sha256 do uuid>, papel participante, expulsa antes", async () => {
    tabelas.reunioes = { id: "r1", titulo: "T", encerrada_em: null, expira_em: FUTURO(), rtk_meeting_id: "m1" };
    const { passeReuniaoVisitante } = await import("@/src/lib/reunioes");
    const p = await passeReuniaoVisitante("abcdefghjk", "Ana", VISITANTE);

    expect(p).toEqual({ token: "tok", nome: "Ana", papel: "participante" });
    expect(expulsar).toHaveBeenCalledWith("m1", [`visitante:${VISITANTE_HASH}`]);
    expect(adicionarParticipante).toHaveBeenCalledWith("m1", { nome: "Ana", preset: "vortex_participante", customId: `visitante:${VISITANTE_HASH}` });
    expect(upsert).toHaveBeenCalledWith("passes_rtk", expect.objectContaining({ custom_id: `visitante:${VISITANTE_HASH}` }), expect.anything());
    expect(JSON.stringify([expulsar.mock.calls, adicionarParticipante.mock.calls, upsert.mock.calls])).not.toContain(VISITANTE);
    expect(expulsar.mock.invocationCallOrder[0]).toBeLessThan(adicionarParticipante.mock.invocationCallOrder[0]);
  });

  it("reunião encerrada ou vencida: ReuniaoEncerrada sem chamar o RealtimeKit", async () => {
    const { passeReuniaoVisitante, passeReuniaoMembro, ReuniaoEncerrada } = await import("@/src/lib/reunioes");
    tabelas.reunioes = { id: "r1", titulo: "T", encerrada_em: PASSADO(), expira_em: FUTURO(), rtk_meeting_id: "m1" };
    await expect(passeReuniaoVisitante("abcdefghjk", "Ana", VISITANTE)).rejects.toBeInstanceOf(ReuniaoEncerrada);
    tabelas.reunioes = { id: "r1", titulo: "T", encerrada_em: null, expira_em: PASSADO(), rtk_meeting_id: "m1" };
    await expect(passeReuniaoMembro("abcdefghjk", MEMBRO)).rejects.toBeInstanceOf(ReuniaoEncerrada);
    expect(expulsar).not.toHaveBeenCalled();
    expect(adicionarParticipante).not.toHaveBeenCalled();
  });

  it("código inexistente ou inválido: RegistroNaoEncontrado", async () => {
    const { passeReuniaoVisitante } = await import("@/src/lib/reunioes");
    const { RegistroNaoEncontrado } = await import("@/src/lib/sala");
    await expect(passeReuniaoVisitante("abcdefghjk", "Ana", VISITANTE)).rejects.toBeInstanceOf(RegistroNaoEncontrado);
    await expect(passeReuniaoVisitante("xx", "Ana", VISITANTE)).rejects.toBeInstanceOf(RegistroNaoEncontrado);
    expect(adicionarParticipante).not.toHaveBeenCalled();
  });
});

describe("encerrarReuniao", () => {
  it("marca encerrada_em PRIMEIRO, depois expulsa todos, depois desativa a meeting", async () => {
    tabelas.reunioes = { id: "r1", titulo: "T", encerrada_em: null, expira_em: FUTURO(), rtk_meeting_id: "m1" };
    const { encerrarReuniao } = await import("@/src/lib/reunioes");
    await encerrarReuniao("abcdefghjk", MEMBRO);

    expect(update).toHaveBeenCalledWith("reunioes", { encerrada_em: expect.any(String) });
    expect(filtros).toHaveBeenCalledWith("reunioes", "update.is", "encerrada_em", null);
    expect(expulsarTodos).toHaveBeenCalledWith("m1");
    expect(desativarMeeting).toHaveBeenCalledWith("m1");
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(expulsarTodos.mock.invocationCallOrder[0]);
    expect(expulsarTodos.mock.invocationCallOrder[0]).toBeLessThan(desativarMeeting.mock.invocationCallOrder[0]);
  });

  it("já encerrada ou vencida: ReuniaoEncerrada sem mexer em nada", async () => {
    const { encerrarReuniao, ReuniaoEncerrada } = await import("@/src/lib/reunioes");
    tabelas.reunioes = { id: "r1", titulo: "T", encerrada_em: PASSADO(), expira_em: FUTURO(), rtk_meeting_id: "m1" };
    await expect(encerrarReuniao("abcdefghjk", MEMBRO)).rejects.toBeInstanceOf(ReuniaoEncerrada);
    tabelas.reunioes = { id: "r1", titulo: "T", encerrada_em: null, expira_em: PASSADO(), rtk_meeting_id: "m1" };
    await expect(encerrarReuniao("abcdefghjk", MEMBRO)).rejects.toBeInstanceOf(ReuniaoEncerrada);
    expect(update).not.toHaveBeenCalled();
    expect(expulsarTodos).not.toHaveBeenCalled();
  });

  it("inexistente: RegistroNaoEncontrado", async () => {
    const { encerrarReuniao } = await import("@/src/lib/reunioes");
    const { RegistroNaoEncontrado } = await import("@/src/lib/sala");
    await expect(encerrarReuniao("abcdefghjk", MEMBRO)).rejects.toBeInstanceOf(RegistroNaoEncontrado);
  });

  it("erro ao gravar encerrada_em rejeita e não expulsa ninguém", async () => {
    tabelas.reunioes = { id: "r1", titulo: "T", encerrada_em: null, expira_em: FUTURO(), rtk_meeting_id: "m1" };
    erroAtualizar = { message: "falhou" };
    const { encerrarReuniao } = await import("@/src/lib/reunioes");
    await expect(encerrarReuniao("abcdefghjk", MEMBRO)).rejects.toThrow();
    expect(expulsarTodos).not.toHaveBeenCalled();
  });
});

describe("fecharReunioesVencidas", () => {
  const AGORA = new Date("2026-10-22T20:00:00Z");

  it("busca as abertas com expira_em <= agora, marca encerrada_em, expulsa todos e desativa cada uma", async () => {
    listas.reunioes = [{ id: "r1", rtk_meeting_id: "m1" }, { id: "r2", rtk_meeting_id: null }];
    const { fecharReunioesVencidas } = await import("@/src/lib/reunioes");
    const n = await fecharReunioesVencidas(AGORA);

    expect(n).toBe(2);
    expect(filtros).toHaveBeenCalledWith("reunioes", "is", "encerrada_em", null);
    expect(filtros).toHaveBeenCalledWith("reunioes", "lte", "expira_em", AGORA.toISOString());
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith("reunioes", { encerrada_em: AGORA.toISOString() });
    expect(expulsarTodos).toHaveBeenCalledTimes(1);
    expect(expulsarTodos).toHaveBeenCalledWith("m1");
    expect(desativarMeeting).toHaveBeenCalledWith("m1");
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(expulsarTodos.mock.invocationCallOrder[0]);
  });

  it("erro do RealtimeKit numa reunião só é logado e não para as outras", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    listas.reunioes = [{ id: "r1", rtk_meeting_id: "m1" }, { id: "r2", rtk_meeting_id: "m2" }];
    expulsarTodos.mockRejectedValueOnce(new ErroRtkFake(500, {}));
    const { fecharReunioesVencidas } = await import("@/src/lib/reunioes");
    const n = await fecharReunioesVencidas(AGORA);
    expect(n).toBe(2);
    expect(desativarMeeting).toHaveBeenCalledWith("m2");
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it("nenhuma vencida devolve 0", async () => {
    const { fecharReunioesVencidas } = await import("@/src/lib/reunioes");
    expect(await fecharReunioesVencidas(AGORA)).toBe(0);
  });
});
