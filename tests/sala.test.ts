import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const update = vi.fn();
const upsert = vi.fn();
const tabelas: Record<string, Record<string, unknown> | null> = {};
const listas: Record<string, Record<string, unknown>[]> = {};
let erroAtualizar: unknown = null;
let erroUpsert: unknown = null;

function consultaImpl(tabela: string) {
  const q = {
    select: () => q,
    eq: () => q,
    lte: () => q,
    maybeSingle: async () => ({ data: tabelas[tabela] ?? null }),
    then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
      Promise.resolve({ data: listas[tabela] ?? [], error: null }).then(ok, falha),
    update: (v: unknown) => {
      update(tabela, v);
      const r = { eq: () => r, then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: erroAtualizar }).then(ok) };
      return r;
    },
    upsert: (v: unknown, o: unknown) => {
      upsert(tabela, v, o);
      return Promise.resolve({ error: erroUpsert });
    },
  };
  return q;
}
const from = vi.fn((tabela: string) => consultaImpl(tabela));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from, rpc }) }));

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

const gravarAoAbrir = vi.fn(async (..._a: unknown[]) => "rec1");
vi.mock("@/src/lib/gravacao", () => ({ gravarAoAbrir: (...a: unknown[]) => gravarAoAbrir(...a) }));

const enfileirarComecou = vi.fn<(sessaoId: string) => Promise<number>>(async () => 0);
vi.mock("@/src/lib/disparos", () => ({ enfileirarComecou: (sessaoId: string) => enfileirarComecou(sessaoId) }));
// `after` do Next roda o callback depois da resposta; aqui roda na hora, sem esperar (como em produção, o passe
// não espera o callback terminar).
const after = vi.fn((fn: () => unknown) => {
  void fn();
});
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => after(fn),
}));

const FUTURO = new Date(Date.now() + 24 * 3600_000).toISOString();

beforeEach(() => {
  for (const k of Object.keys(tabelas)) delete tabelas[k];
  for (const k of Object.keys(listas)) delete listas[k];
  erroAtualizar = null;
  erroUpsert = null;
  upsert.mockReset();
  excluirParticipante.mockReset();
  desativarMeeting.mockReset();
  rpc.mockReset();
  update.mockReset();
  from.mockClear();
  criarMeeting.mockReset();
  adicionarParticipante.mockReset();
  expulsar.mockReset();
  expulsarTodos.mockReset();
  adicionarParticipante.mockResolvedValue({ id: "p1", token: "tok" });
  enfileirarComecou.mockReset();
  enfileirarComecou.mockResolvedValue(0);
  after.mockClear();
  gravarAoAbrir.mockClear();
});

describe("código inválido", () => {
  it("estadoPorCodigo não consulta o banco", async () => {
    const { estadoPorCodigo } = await import("@/src/lib/sala");
    const r = await estadoPorCodigo("formato-errado");
    expect(r).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
  it("passeConvidado não consulta o banco", async () => {
    const { passeConvidado, RegistroNaoEncontrado } = await import("@/src/lib/sala");
    await expect(passeConvidado("formato-errado")).rejects.toBeInstanceOf(RegistroNaoEncontrado);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("passeConvidado", () => {
  it("fora da janela: sem passe e sem chamar o RealtimeKit", async () => {
    tabelas.inscricoes = { id: "insc1", nome: "Ana", status: "agendado", sessao_id: "sess1" };
    tabelas.sessoes = { id: "sess1", status: "agendada", inicio: FUTURO, agenda_id: "ag1" };
    tabelas.agendas = { duracao_min: 60, abre_antes_min: 5, slug: "vendas" };

    const { passeConvidado } = await import("@/src/lib/sala");
    const r = await passeConvidado("abcdefghjk");

    expect(r.passe).toBeUndefined();
    expect(r.estado).toBe("espera");
    expect(criarMeeting).not.toHaveBeenCalled();
    expect(expulsar).not.toHaveBeenCalled();
    expect(adicionarParticipante).not.toHaveBeenCalled();
  });

  it("sessão ao_vivo: expulsa antes de adicionar, preset vortex_convidado", async () => {
    tabelas.inscricoes = { id: "insc1", nome: "Ana", status: "agendado", sessao_id: "sess1" };
    tabelas.sessoes = { id: "sess1", status: "ao_vivo", inicio: FUTURO, agenda_id: "ag1", rtk_meeting_id: "m1" };
    tabelas.agendas = { duracao_min: 60, abre_antes_min: 5, slug: "vendas" };

    const { passeConvidado } = await import("@/src/lib/sala");
    const r = await passeConvidado("abcdefghjk");

    expect(r.estado).toBe("aberta");
    expect(r.passe).toEqual({ token: "tok", nome: "Ana", papel: "convidado", transcreve: false });
    expect(expulsar).toHaveBeenCalledWith("m1", ["insc1"]);
    expect(adicionarParticipante).toHaveBeenCalledWith("m1", { nome: "Ana", preset: "vortex_convidado", customId: "insc1" });
    expect(expulsar.mock.invocationCallOrder[0]).toBeLessThan(adicionarParticipante.mock.invocationCallOrder[0]);
  });
});

describe("garantirMeeting", () => {
  it("com id já salvo não cria meeting", async () => {
    tabelas.sessoes = { rtk_meeting_id: "m-existente", agenda_id: "ag1" };
    const { garantirMeeting } = await import("@/src/lib/sala");
    const id = await garantirMeeting("sess1");
    expect(id).toBe("m-existente");
    expect(criarMeeting).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sem id cria e reserva", async () => {
    tabelas.sessoes = { rtk_meeting_id: null, titulo: null, agenda_id: "ag1" };
    tabelas.agendas = { nome: "Agenda X", grava_sozinha: false };
    criarMeeting.mockResolvedValue({ id: "m-novo" });
    rpc.mockResolvedValue({ data: "m-novo", error: null });

    const { garantirMeeting } = await import("@/src/lib/sala");
    const id = await garantirMeeting("sess1");

    expect(criarMeeting).toHaveBeenCalledWith({ titulo: "Agenda X", transcrever: false });
    expect(rpc).toHaveBeenCalledWith("reservar_meeting", { p_sessao: "sess1", p_meeting: "m-novo" });
    expect(id).toBe("m-novo");
  });

  it("corrida (outra entrada ganhou): devolve o id do banco", async () => {
    tabelas.sessoes = { rtk_meeting_id: null, titulo: null, agenda_id: "ag1" };
    tabelas.agendas = { nome: "Agenda X", grava_sozinha: true };
    criarMeeting.mockResolvedValue({ id: "m-perdeu" });
    rpc.mockResolvedValue({ data: "m-ganhou", error: null });

    const { garantirMeeting } = await import("@/src/lib/sala");
    const id = await garantirMeeting("sess1");

    expect(id).toBe("m-ganhou");
  });

  it("erro na reserva rejeita e não cai de volta pro id recém-criado", async () => {
    tabelas.sessoes = { rtk_meeting_id: null, titulo: null, agenda_id: "ag1" };
    tabelas.agendas = { nome: "Agenda X", grava_sozinha: true };
    criarMeeting.mockResolvedValue({ id: "m-novo-sem-uso" });
    rpc.mockResolvedValue({ data: null, error: { message: "falhou" } });

    const { garantirMeeting } = await import("@/src/lib/sala");
    await expect(garantirMeeting("sess1")).rejects.toThrow();
  });

  it("sessão não encontrada rejeita e não chama criarMeeting", async () => {
    const { garantirMeeting, RegistroNaoEncontrado } = await import("@/src/lib/sala");
    await expect(garantirMeeting("sess-fantasma")).rejects.toBeInstanceOf(RegistroNaoEncontrado);
    expect(criarMeeting).not.toHaveBeenCalled();
  });
});

describe("transcrição (agenda com transcrever)", () => {
  it("meeting nova nasce com transcrição e a sessão fica marcada", async () => {
    tabelas.sessoes = { rtk_meeting_id: null, titulo: null, agenda_id: "ag1" };
    tabelas.agendas = { nome: "Implementação", transcrever: true };
    criarMeeting.mockResolvedValue({ id: "m-novo" });
    rpc.mockResolvedValue({ data: "m-novo", error: null });

    const { meetingDaSessao } = await import("@/src/lib/sala");
    expect(await meetingDaSessao("sess1")).toEqual({ id: "m-novo", transcreve: true });
    expect(criarMeeting).toHaveBeenCalledWith({ titulo: "Implementação", transcrever: true });
    expect(update).toHaveBeenCalledWith("sessoes", { rtk_transcreve: true });
  });

  it("agenda sem transcrever: meeting sem transcrição e sem marcar a sessão", async () => {
    tabelas.sessoes = { rtk_meeting_id: null, titulo: null, agenda_id: "ag1" };
    tabelas.agendas = { nome: "Vendas", transcrever: false };
    criarMeeting.mockResolvedValue({ id: "m-novo" });
    rpc.mockResolvedValue({ data: "m-novo", error: null });

    const { meetingDaSessao } = await import("@/src/lib/sala");
    expect(await meetingDaSessao("sess1")).toEqual({ id: "m-novo", transcreve: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("falha ao marcar a sessão: segue sem transcrição (nunca impede a entrada)", async () => {
    tabelas.sessoes = { rtk_meeting_id: null, titulo: null, agenda_id: "ag1" };
    tabelas.agendas = { nome: "Implementação", transcrever: true };
    criarMeeting.mockResolvedValue({ id: "m-novo" });
    rpc.mockResolvedValue({ data: "m-novo", error: null });
    erroAtualizar = { message: "falhou" };
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});

    const { meetingDaSessao } = await import("@/src/lib/sala");
    expect(await meetingDaSessao("sess1")).toEqual({ id: "m-novo", transcreve: false });
    erro.mockRestore();
  });

  it("meeting que já existe: transcreve só com a marca da sessão E a agenda ligada", async () => {
    const { meetingDaSessao } = await import("@/src/lib/sala");
    tabelas.sessoes = { rtk_meeting_id: "m1", rtk_transcreve: true, agenda_id: "ag1" };
    tabelas.agendas = { nome: "A", transcrever: true };
    expect(await meetingDaSessao("sess1")).toEqual({ id: "m1", transcreve: true });
    tabelas.agendas = { nome: "A", transcrever: false };
    expect(await meetingDaSessao("sess1")).toEqual({ id: "m1", transcreve: false });
    // Meeting criada antes de ligar a chave (sem ai_config em pt-BR): não transcreve.
    tabelas.sessoes = { rtk_meeting_id: "m1", rtk_transcreve: false, agenda_id: "ag1" };
    tabelas.agendas = { nome: "A", transcrever: true };
    expect(await meetingDaSessao("sess1")).toEqual({ id: "m1", transcreve: false });
    expect(criarMeeting).not.toHaveBeenCalled();
  });

  it("passes usam os presets _transcricao (menos o espião) e avisam a sala", async () => {
    tabelas.sessoes = { id: "sess1", status: "ao_vivo", inicio: FUTURO, rtk_meeting_id: "m1", rtk_transcreve: true, agenda_id: "ag1" };
    tabelas.agendas = { nome: "A", transcrever: true, duracao_min: 60, abre_antes_min: 5, slug: "implementacao-ia" };
    tabelas.inscricoes = { id: "insc1", nome: "Ana", status: "agendado", sessao_id: "sess1" };
    const { passeConvidado, passeEquipe } = await import("@/src/lib/sala");

    const c = await passeConvidado("abcdefghjk");
    expect(c.passe).toEqual({ token: "tok", nome: "Ana", papel: "convidado", transcreve: true });
    expect(adicionarParticipante).toHaveBeenLastCalledWith("m1", expect.objectContaining({ preset: "vortex_convidado_transcricao" }));

    const a = await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao");
    expect(a.transcreve).toBe(true);
    expect(adicionarParticipante).toHaveBeenLastCalledWith("m1", expect.objectContaining({ preset: "vortex_anfitriao_transcricao" }));

    await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "espiao");
    expect(adicionarParticipante).toHaveBeenLastCalledWith("m1", expect.objectContaining({ preset: "vortex_espiao" }));
  });
});

describe("passeEquipe", () => {
  it("anfitrião marca a sessão ao_vivo, customId membro:<id>, preset vortex_anfitriao", async () => {
    tabelas.sessoes = { id: "sess1", status: "agendada", rtk_meeting_id: "m1", agenda_id: "ag1" };
    const { passeEquipe } = await import("@/src/lib/sala");
    const p = await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao");

    expect(update).toHaveBeenCalledWith("sessoes", expect.objectContaining({ status: "ao_vivo", aberta_em: expect.any(String) }));
    expect(expulsar).toHaveBeenCalledWith("m1", ["membro:memb1"]);
    expect(adicionarParticipante).toHaveBeenCalledWith("m1", { nome: "Bento", preset: "vortex_anfitriao", customId: "membro:memb1" });
    expect(p).toEqual({ token: "tok", nome: "Bento", papel: "anfitriao", transcreve: false });
  });

  it("anfitrião cria a meeting antes de marcar ao_vivo", async () => {
    tabelas.sessoes = { id: "sess1", status: "agendada", rtk_meeting_id: null, titulo: null, agenda_id: "ag1" };
    tabelas.agendas = { nome: "Agenda Y", grava_sozinha: false };
    criarMeeting.mockResolvedValue({ id: "m-criada" });
    rpc.mockResolvedValue({ data: "m-criada", error: null });

    const { passeEquipe } = await import("@/src/lib/sala");
    await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao");

    expect(criarMeeting).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("sessoes", expect.objectContaining({ status: "ao_vivo" }));
    expect(criarMeeting.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
  });

  it("agenda que grava sozinha: ao abrir, começa a gravar no after() pela sessão", async () => {
    tabelas.sessoes = { id: "sess1", status: "agendada", rtk_meeting_id: "m1", agenda_id: "ag1", agendas: { duracao_min: 60, grava_sozinha: true } };
    const { passeEquipe } = await import("@/src/lib/sala");
    await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao");
    expect(gravarAoAbrir).toHaveBeenCalledWith({ tipo: "sessao", id: "sess1" }, "m1");
  });

  it("não grava sozinha: agenda sem grava_sozinha, anfitrião voltando (já ao_vivo) ou espião", async () => {
    tabelas.sessoes = { id: "sess1", status: "agendada", rtk_meeting_id: "m1", agenda_id: "ag1", agendas: { duracao_min: 60, grava_sozinha: false } };
    const { passeEquipe } = await import("@/src/lib/sala");
    await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao");
    tabelas.sessoes = { id: "sess1", status: "ao_vivo", rtk_meeting_id: "m1", agenda_id: "ag1", agendas: { duracao_min: 60, grava_sozinha: true } };
    await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao");
    await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "espiao");
    expect(gravarAoAbrir).not.toHaveBeenCalled();
  });

  it("espião não marca a sessão ao_vivo, preset vortex_espiao", async () => {
    tabelas.sessoes = { id: "sess1", status: "ao_vivo", rtk_meeting_id: "m1", agenda_id: "ag1" };
    const { passeEquipe } = await import("@/src/lib/sala");
    await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "espiao");

    expect(update).not.toHaveBeenCalled();
    expect(adicionarParticipante).toHaveBeenCalledWith("m1", { nome: "Bento", preset: "vortex_espiao", customId: "membro:memb1" });
  });

  it("anfitrião em sessão já ao_vivo não escreve status de novo", async () => {
    tabelas.sessoes = { id: "sess1", status: "ao_vivo", rtk_meeting_id: "m1", agenda_id: "ag1" };
    const { passeEquipe } = await import("@/src/lib/sala");
    await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao");
    expect(update).not.toHaveBeenCalled();
  });

  it("sessão encerrada lança SessaoIndisponivel sem chamar o RealtimeKit", async () => {
    tabelas.sessoes = { id: "sess1", status: "encerrada", rtk_meeting_id: "m1", agenda_id: "ag1" };
    const { passeEquipe, SessaoIndisponivel } = await import("@/src/lib/sala");
    await expect(passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao")).rejects.toBeInstanceOf(SessaoIndisponivel);
    expect(criarMeeting).not.toHaveBeenCalled();
    expect(expulsar).not.toHaveBeenCalled();
  });

  it("erro ao marcar ao_vivo rejeita e não chega a expulsar/adicionar", async () => {
    tabelas.sessoes = { id: "sess1", status: "agendada", rtk_meeting_id: "m1", agenda_id: "ag1" };
    erroAtualizar = { message: "falhou" };
    const { passeEquipe } = await import("@/src/lib/sala");
    await expect(passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao")).rejects.toThrow();
    expect(expulsar).not.toHaveBeenCalled();
    expect(adicionarParticipante).not.toHaveBeenCalled();
  });
});

describe("encerrarSessao", () => {
  it("grava encerrada, depois expulsa todo mundo, depois desativa a meeting", async () => {
    tabelas.sessoes = { status: "ao_vivo", rtk_meeting_id: "m1" };
    const { encerrarSessao } = await import("@/src/lib/sala");
    await encerrarSessao("sess1");

    expect(update).toHaveBeenCalledWith("sessoes", { status: "encerrada" });
    expect(expulsarTodos).toHaveBeenCalledWith("m1");
    expect(desativarMeeting).toHaveBeenCalledWith("m1");
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(expulsarTodos.mock.invocationCallOrder[0]);
    expect(expulsarTodos.mock.invocationCallOrder[0]).toBeLessThan(desativarMeeting.mock.invocationCallOrder[0]);
  });

  it("sessão inexistente lança RegistroNaoEncontrado sem gravar nada", async () => {
    const { encerrarSessao, RegistroNaoEncontrado } = await import("@/src/lib/sala");
    await expect(encerrarSessao("sess-fantasma")).rejects.toBeInstanceOf(RegistroNaoEncontrado);
    expect(update).not.toHaveBeenCalled();
  });

  it("sessão já encerrada ou cancelada lança SessaoIndisponivel sem chamar o RealtimeKit", async () => {
    const { encerrarSessao, SessaoIndisponivel } = await import("@/src/lib/sala");
    for (const status of ["encerrada", "cancelada"]) {
      tabelas.sessoes = { status, rtk_meeting_id: "m1" };
      await expect(encerrarSessao("sess1")).rejects.toBeInstanceOf(SessaoIndisponivel);
    }
    expect(update).not.toHaveBeenCalled();
    expect(expulsarTodos).not.toHaveBeenCalled();
  });

  it("sem rtk_meeting_id só grava encerrada", async () => {
    tabelas.sessoes = { status: "agendada", rtk_meeting_id: null };
    const { encerrarSessao } = await import("@/src/lib/sala");
    await encerrarSessao("sess1");

    expect(expulsarTodos).not.toHaveBeenCalled();
    expect(desativarMeeting).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("sessoes", { status: "encerrada" });
  });

  it("erro ao gravar encerrada rejeita e não expulsa ninguém", async () => {
    tabelas.sessoes = { status: "ao_vivo", rtk_meeting_id: "m1" };
    erroAtualizar = { message: "falhou" };
    const { encerrarSessao } = await import("@/src/lib/sala");
    await expect(encerrarSessao("sess1")).rejects.toThrow();
    expect(expulsarTodos).not.toHaveBeenCalled();
  });
});

describe("uma presença por pessoa (passes_rtk)", () => {
  const sessaoAberta = () => {
    tabelas.inscricoes = { id: "insc1", nome: "Ana", status: "agendado", sessao_id: "sess1" };
    tabelas.sessoes = { id: "sess1", status: "ao_vivo", inicio: FUTURO, agenda_id: "ag1", rtk_meeting_id: "m1" };
    tabelas.agendas = { duracao_min: 60, abre_antes_min: 5, slug: "vendas" };
  };

  it("primeiro passe da pessoa não apaga ninguém e guarda o participant_id novo", async () => {
    sessaoAberta();
    const { passeConvidado } = await import("@/src/lib/sala");
    await passeConvidado("abcdefghjk");
    expect(excluirParticipante).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      "passes_rtk",
      expect.objectContaining({ custom_id: "insc1", meeting_id: "m1", participant_id: "p1" }),
      { onConflict: "custom_id,meeting_id" },
    );
  });

  it("segundo passe apaga o participante anterior depois de adicionar e guardar o novo", async () => {
    sessaoAberta();
    tabelas.passes_rtk = { participant_id: "p0" };
    const { passeConvidado } = await import("@/src/lib/sala");
    const r = await passeConvidado("abcdefghjk");
    expect(r.passe?.token).toBe("tok");
    expect(excluirParticipante).toHaveBeenCalledWith("m1", "p0");
    expect(adicionarParticipante.mock.invocationCallOrder[0]).toBeLessThan(upsert.mock.invocationCallOrder[0]);
    expect(upsert.mock.invocationCallOrder[0]).toBeLessThan(excluirParticipante.mock.invocationCallOrder[0]);
  });

  it("equipe: segundo passe do membro apaga o participante anterior", async () => {
    tabelas.sessoes = { id: "sess1", status: "ao_vivo", rtk_meeting_id: "m1", agenda_id: "ag1" };
    tabelas.passes_rtk = { participant_id: "p-velho" };
    const { passeEquipe } = await import("@/src/lib/sala");
    await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao");
    expect(upsert).toHaveBeenCalledWith("passes_rtk", expect.objectContaining({ custom_id: "membro:memb1", meeting_id: "m1", participant_id: "p1" }), expect.anything());
    expect(excluirParticipante).toHaveBeenCalledWith("m1", "p-velho");
  });

  it("equipe: primeiro passe do membro não apaga ninguém", async () => {
    tabelas.sessoes = { id: "sess1", status: "ao_vivo", rtk_meeting_id: "m1", agenda_id: "ag1" };
    const { passeEquipe } = await import("@/src/lib/sala");
    await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao");
    expect(excluirParticipante).not.toHaveBeenCalled();
  });

  it("erro ao guardar o passe rejeita e não apaga o anterior", async () => {
    sessaoAberta();
    tabelas.passes_rtk = { participant_id: "p0" };
    erroUpsert = { message: "falhou" };
    const { passeConvidado } = await import("@/src/lib/sala");
    await expect(passeConvidado("abcdefghjk")).rejects.toThrow();
    expect(excluirParticipante).not.toHaveBeenCalled();
  });
});

describe("passeEquipe: registro do anfitrião", () => {
  it("anfitrião (abrindo ou voltando) pede pra gravar quem conduziu; o banco só grava o primeiro", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    tabelas.sessoes = { id: "sess1", status: "agendada", rtk_meeting_id: "m1", agenda_id: "ag1" };
    const { passeEquipe } = await import("@/src/lib/sala");
    await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao");
    tabelas.sessoes = { id: "sess1", status: "ao_vivo", rtk_meeting_id: "m1", agenda_id: "ag1" };
    await passeEquipe("sess1", { id: "memb2", nome: "Gus" }, "anfitriao");
    expect(rpc).toHaveBeenNthCalledWith(1, "marcar_anfitriao", { p_sessao: "sess1", p_usuario: "memb1" });
    expect(rpc).toHaveBeenNthCalledWith(2, "marcar_anfitriao", { p_sessao: "sess1", p_usuario: "memb2" });
  });

  it("espião não conta como anfitrião", async () => {
    tabelas.sessoes = { id: "sess1", status: "ao_vivo", rtk_meeting_id: "m1", agenda_id: "ag1" };
    const { passeEquipe } = await import("@/src/lib/sala");
    await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "espiao");
    expect(rpc).not.toHaveBeenCalledWith("marcar_anfitriao", expect.anything());
  });

  it("falha ao registrar não impede a entrada", async () => {
    rpc.mockRejectedValue(new Error("rede"));
    tabelas.sessoes = { id: "sess1", status: "ao_vivo", rtk_meeting_id: "m1", agenda_id: "ag1" };
    const { passeEquipe } = await import("@/src/lib/sala");
    await expect(passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao")).resolves.toMatchObject({ papel: "anfitriao" });
  });
});

describe("passeEquipe: regras de horário e espião", () => {
  it("espião com a sessão ainda agendada lança SessaoIndisponivel sem chamar o RealtimeKit", async () => {
    tabelas.sessoes = { id: "sess1", status: "agendada", rtk_meeting_id: null, agenda_id: "ag1" };
    const { passeEquipe, SessaoIndisponivel } = await import("@/src/lib/sala");
    await expect(passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "espiao")).rejects.toBeInstanceOf(SessaoIndisponivel);
    expect(criarMeeting).not.toHaveBeenCalled();
    expect(adicionarParticipante).not.toHaveBeenCalled();
  });

  it("depois de início + duração + 2h recusa (anfitrião e espião)", async () => {
    const inicio = new Date(Date.now() - (60 + 120 + 1) * 60_000).toISOString();
    tabelas.sessoes = { id: "sess1", status: "ao_vivo", inicio, rtk_meeting_id: "m1", agenda_id: "ag1", agendas: { duracao_min: 60 } };
    const { passeEquipe, SessaoIndisponivel } = await import("@/src/lib/sala");
    await expect(passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao")).rejects.toBeInstanceOf(SessaoIndisponivel);
    await expect(passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "espiao")).rejects.toBeInstanceOf(SessaoIndisponivel);
    expect(adicionarParticipante).not.toHaveBeenCalled();
  });

  it("um pouco antes do prazo final ainda entra", async () => {
    const inicio = new Date(Date.now() - (60 + 119) * 60_000).toISOString();
    tabelas.sessoes = { id: "sess1", status: "ao_vivo", inicio, rtk_meeting_id: "m1", agenda_id: "ag1", agendas: { duracao_min: 60 } };
    const { passeEquipe } = await import("@/src/lib/sala");
    await expect(passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao")).resolves.toMatchObject({ papel: "anfitriao" });
  });
});

describe("fecharSessoesVencidas", () => {
  const AGORA = new Date("2026-10-22T20:00:00Z");
  const horasAntes = (h: number) => new Date(AGORA.getTime() - h * 3600_000).toISOString();

  it("fecha só as ao_vivo que passaram de início + duração + 2h: encerrada, expulsa todos, desativa", async () => {
    listas.sessoes = [
      { id: "s1", inicio: horasAntes(4), rtk_meeting_id: "m1", agendas: { duracao_min: 60 } },
      { id: "s2", inicio: horasAntes(2.5), rtk_meeting_id: "m2", agendas: { duracao_min: 60 } },
      { id: "s3", inicio: horasAntes(5), rtk_meeting_id: null, agendas: { duracao_min: 120 } },
    ];
    const { fecharSessoesVencidas } = await import("@/src/lib/sala");
    const n = await fecharSessoesVencidas(AGORA);

    expect(n).toBe(2);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith("sessoes", { status: "encerrada" });
    expect(expulsarTodos).toHaveBeenCalledTimes(1);
    expect(expulsarTodos).toHaveBeenCalledWith("m1");
    expect(desativarMeeting).toHaveBeenCalledWith("m1");
    expect(desativarMeeting).not.toHaveBeenCalledWith("m2");
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(expulsarTodos.mock.invocationCallOrder[0]);
    expect(expulsarTodos.mock.invocationCallOrder[0]).toBeLessThan(desativarMeeting.mock.invocationCallOrder[0]);
  });

  it("erro do RealtimeKit numa sessão só é logado e não para as outras", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    listas.sessoes = [
      { id: "s1", inicio: horasAntes(4), rtk_meeting_id: "m1", agendas: { duracao_min: 60 } },
      { id: "s2", inicio: horasAntes(4), rtk_meeting_id: "m2", agendas: { duracao_min: 60 } },
    ];
    expulsarTodos.mockRejectedValueOnce(new ErroRtkFake(500, {}));
    const { fecharSessoesVencidas } = await import("@/src/lib/sala");
    const n = await fecharSessoesVencidas(AGORA);

    expect(n).toBe(2);
    expect(expulsarTodos).toHaveBeenCalledWith("m2");
    expect(desativarMeeting).toHaveBeenCalledWith("m2");
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it("nenhuma sessão vencida devolve 0", async () => {
    const { fecharSessoesVencidas } = await import("@/src/lib/sala");
    expect(await fecharSessoesVencidas(AGORA)).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("statusDaSessao", () => {
  it("devolve o status ou null", async () => {
    const { statusDaSessao } = await import("@/src/lib/sala");
    expect(await statusDaSessao("sess1")).toBeNull();
    tabelas.sessoes = { status: "encerrada" };
    expect(await statusDaSessao("sess1")).toBe("encerrada");
  });
});

describe("passeEquipe: evento comecou", () => {
  it("abrir a sala não enfileira comecou (o aviso sai pelo cron na hora marcada)", async () => {
    tabelas.sessoes = { id: "sess1", status: "agendada", rtk_meeting_id: "m1", agenda_id: "ag1" };
    const { passeEquipe } = await import("@/src/lib/sala");
    await passeEquipe("sess1", { id: "memb1", nome: "Bento" }, "anfitriao");
    expect(enfileirarComecou).not.toHaveBeenCalled();
  });
});
