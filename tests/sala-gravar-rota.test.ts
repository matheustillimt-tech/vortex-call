import { beforeEach, describe, expect, it, vi } from "vitest";

const SESS = "11111111-2222-4333-8444-555555555555";
const tabelas: Record<string, Record<string, unknown> | null> = {};
const from = vi.fn((tabela: string) => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: tabelas[tabela] ?? null }) };
  return q;
});
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from }) }));

class ErroRtkFake extends Error {
  constructor(public status: number, public corpo: unknown) {
    super(`RealtimeKit respondeu ${status}`);
  }
}
vi.mock("@/src/lib/realtimekit", () => ({ ErroRtk: ErroRtkFake }));
const comecarGravacao = vi.fn<(alvo: { tipo: string; id: string }, m: string) => Promise<string>>(async () => "rec1");
const pararGravacao = vi.fn<(m: string) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/gravacao", () => ({
  comecarGravacao: (alvo: { tipo: string; id: string }, m: string) => comecarGravacao(alvo, m),
  pararGravacao: (m: string) => pararGravacao(m),
}));
const membroApi = vi.fn<() => Promise<{ id: string; nome: string; papel: string; permissoes?: Record<string, boolean> } | null>>(async () => null);
vi.mock("@/src/lib/supabase/usuario", () => ({ membroApi: () => membroApi() }));

const podeVerSessao = vi.fn<(quem: unknown, sessao: string) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/acesso", () => ({ podeVerSessao: (quem: unknown, sessao: string) => podeVerSessao(quem, sessao) }));

beforeEach(() => {
  podeVerSessao.mockReset();
  podeVerSessao.mockResolvedValue(true);
  for (const k of Object.keys(tabelas)) delete tabelas[k];
  from.mockClear();
  comecarGravacao.mockReset();
  comecarGravacao.mockResolvedValue("rec1");
  pararGravacao.mockReset();
  pararGravacao.mockResolvedValue(true);
  membroApi.mockReset();
  membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro" });
});

async function post(corpo: unknown, alvo = SESS) {
  const { POST } = await import("@/app/api/sala/gravar/[alvo]/route");
  return POST(new Request("http://x", { method: "POST", body: JSON.stringify(corpo) }), { params: Promise.resolve({ alvo }) });
}

describe("POST /api/sala/gravar/[alvo]", () => {
  it("401 sem login", async () => {
    membroApi.mockResolvedValue(null);
    expect((await post({ tipo: "sessao", ligar: true })).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("400 com corpo inválido; 404 com alvo que não é uuid ou não existe", async () => {
    expect((await post({ tipo: "outro", ligar: true })).status).toBe(400);
    expect((await post({ tipo: "sessao", ligar: "sim" })).status).toBe(400);
    expect((await post({ tipo: "sessao", ligar: true }, "x")).status).toBe(404);
    expect((await post({ tipo: "sessao", ligar: true })).status).toBe(404);
  });

  it("sessão ao vivo: ligar começa a gravar a sessão", async () => {
    tabelas.sessoes = { status: "ao_vivo", rtk_meeting_id: "meet-1" };
    const r = await post({ tipo: "sessao", ligar: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(comecarGravacao).toHaveBeenCalledWith({ tipo: "sessao", id: SESS }, "meet-1");
    expect(from).toHaveBeenCalledWith("sessoes");
  });

  it("reunião ativa: ligar grava a reunião; desligar para", async () => {
    tabelas.reunioes = { encerrada_em: null, expira_em: new Date(Date.now() + 3600_000).toISOString(), rtk_meeting_id: "meet-r" };
    expect((await post({ tipo: "reuniao", ligar: true })).status).toBe(200);
    expect(comecarGravacao).toHaveBeenCalledWith({ tipo: "reuniao", id: SESS }, "meet-r");
    expect((await post({ tipo: "reuniao", ligar: false })).status).toBe(200);
    expect(pararGravacao).toHaveBeenCalledWith("meet-r");
  });

  it("409 sem meeting; 409 ao ligar com a call fechada (parar ainda funciona)", async () => {
    tabelas.sessoes = { status: "agendada", rtk_meeting_id: null };
    expect((await post({ tipo: "sessao", ligar: true })).status).toBe(409);
    tabelas.sessoes = { status: "encerrada", rtk_meeting_id: "meet-1" };
    expect((await post({ tipo: "sessao", ligar: true })).status).toBe(409);
    expect(comecarGravacao).not.toHaveBeenCalled();
    expect((await post({ tipo: "sessao", ligar: false })).status).toBe(200);
  });

  it("RealtimeKit falhou → 502 com mensagem", async () => {
    tabelas.sessoes = { status: "ao_vivo", rtk_meeting_id: "meet-1" };
    comecarGravacao.mockRejectedValue(new ErroRtkFake(400, {}));
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await post({ tipo: "sessao", ligar: true });
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ erro: "Não deu para começar a gravar." });
    erro.mockRestore();
  });
});

describe("gravar: vendedor de outra agenda", () => {
  it("404 na sessão de outra agenda, sem gravar; reunião segue liberada", async () => {
    podeVerSessao.mockResolvedValue(false);
    tabelas.sessoes = { status: "ao_vivo", rtk_meeting_id: "m1" };
    expect((await post({ tipo: "sessao", ligar: true })).status).toBe(404);
    expect(podeVerSessao).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }), SESS);
    expect(comecarGravacao).not.toHaveBeenCalled();
    tabelas.reunioes = { encerrada_em: null, expira_em: new Date(Date.now() + 3600_000).toISOString(), rtk_meeting_id: "m2" };
    expect((await post({ tipo: "reuniao", ligar: true })).status).toBe(200);
  });
});

describe("permissões", () => {
  it("sessão: sem anfitriao (só espião) não liga nem desliga a gravação", async () => {
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro", permissoes: { anfitriao: false } });
    tabelas.sessoes = { status: "ao_vivo", rtk_meeting_id: "m-1" };
    for (const ligar of [true, false]) expect((await post({ tipo: "sessao", ligar })).status).toBe(403);
    expect(comecarGravacao).not.toHaveBeenCalled();
    expect(pararGravacao).not.toHaveBeenCalled();
  });
  it("reunião: sem reunioes, 403; com reunioes (sem anfitriao) grava", async () => {
    tabelas.reunioes = { encerrada_em: null, expira_em: "2999-01-01T00:00:00Z", rtk_meeting_id: "m-r" };
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro", permissoes: { reunioes: false } });
    expect((await post({ tipo: "reuniao", ligar: true })).status).toBe(403);
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro", permissoes: { anfitriao: false } });
    expect((await post({ tipo: "reuniao", ligar: true })).status).toBe(200);
  });
  it("admin com as chaves desligadas no jsonb grava", async () => {
    membroApi.mockResolvedValue({ id: "a", nome: "Gus", papel: "admin", permissoes: { anfitriao: false, reunioes: false } });
    tabelas.sessoes = { status: "ao_vivo", rtk_meeting_id: "m-1" };
    expect((await post({ tipo: "sessao", ligar: true })).status).toBe(200);
  });
});
