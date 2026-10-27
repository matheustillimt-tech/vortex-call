import { beforeEach, describe, expect, it, vi } from "vitest";

const SESS = "11111111-2222-4333-8444-555555555555";
const sessaoAceitaTrechos = vi.fn<(s: string) => Promise<boolean>>(async () => true);
const salvarTrechos = vi.fn<(s: string, t: unknown[]) => Promise<void>>(async () => {});
const listarTrechos = vi.fn<(s: string, desde?: string) => Promise<unknown[]>>(async () => []);
vi.mock("@/src/lib/transcricao", () => ({
  sessaoAceitaTrechos: (s: string) => sessaoAceitaTrechos(s),
  salvarTrechos: (s: string, t: unknown[]) => salvarTrechos(s, t),
  listarTrechos: (s: string, d?: string) => listarTrechos(s, d),
}));
const membroApi = vi.fn<() => Promise<{ id: string; nome: string; papel: string; permissoes?: Record<string, boolean> } | null>>(async () => null);
vi.mock("@/src/lib/supabase/usuario", () => ({ membroApi: () => membroApi() }));
const podeVerSessao = vi.fn<(quem: unknown, sessao: string) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/acesso", () => ({ podeVerSessao: (quem: unknown, sessao: string) => podeVerSessao(quem, sessao) }));

const fala = (id: string) => ({ id, name: "Ana", customParticipantId: "insc-1", transcript: "Quero um agente", isPartialTranscript: false, date: new Date().toISOString() });

beforeEach(() => {
  sessaoAceitaTrechos.mockReset();
  sessaoAceitaTrechos.mockResolvedValue(true);
  salvarTrechos.mockClear();
  listarTrechos.mockReset();
  listarTrechos.mockResolvedValue([]);
  podeVerSessao.mockReset();
  podeVerSessao.mockResolvedValue(true);
  membroApi.mockReset();
  membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro" });
});

async function post(corpo: unknown, sessao = SESS) {
  const { POST } = await import("@/app/api/sala/transcricao/[sessao]/route");
  return POST(new Request("http://x", { method: "POST", body: JSON.stringify(corpo) }), { params: Promise.resolve({ sessao }) });
}
async function get(qs = "", sessao = SESS) {
  const { GET } = await import("@/app/api/sala/transcricao/[sessao]/route");
  return GET(new Request(`http://x/api/sala/transcricao/${sessao}${qs}`), { params: Promise.resolve({ sessao }) });
}

describe("POST /api/sala/transcricao/[sessao]", () => {
  it("anfitrião manda o lote e grava só as falas válidas", async () => {
    const r = await post({ trechos: [fala("t1"), fala("t1"), { ...fala("t2"), isPartialTranscript: true }, fala("t3")] });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ gravados: 2 });
    expect(salvarTrechos).toHaveBeenCalledWith(SESS, [expect.objectContaining({ id: "t1" }), expect.objectContaining({ id: "t3" })]);
  });
  it("401 sem login; 403 sem a permissão anfitrião; 404 sem acesso ou id ruim", async () => {
    membroApi.mockResolvedValue(null);
    expect((await post({ trechos: [] })).status).toBe(401);
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro", permissoes: { anfitriao: false } });
    expect((await post({ trechos: [] })).status).toBe(403);
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro" });
    expect((await post({ trechos: [] }, "x")).status).toBe(404);
    podeVerSessao.mockResolvedValue(false);
    expect((await post({ trechos: [] })).status).toBe(404);
    expect(salvarTrechos).not.toHaveBeenCalled();
  });
  it("400 com corpo ruim; 409 em sessão que não transcreve", async () => {
    expect((await post({ x: 1 })).status).toBe(400);
    sessaoAceitaTrechos.mockResolvedValue(false);
    expect((await post({ trechos: [fala("t1")] })).status).toBe(409);
    expect(salvarTrechos).not.toHaveBeenCalled();
  });
});

describe("GET /api/sala/transcricao/[sessao]", () => {
  it("devolve as falas e o `agora` pra próxima busca; repassa `desde` válido", async () => {
    listarTrechos.mockResolvedValue([{ id: "t1" }]);
    const r = await get("?desde=2026-10-26T18:00:00.000Z");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.trechos).toEqual([{ id: "t1" }]);
    expect(typeof j.agora).toBe("string");
    expect(listarTrechos).toHaveBeenCalledWith(SESS, "2026-10-26T18:00:00.000Z");
    await get("?desde=lixo");
    expect(listarTrechos).toHaveBeenLastCalledWith(SESS, undefined);
  });
  it("403 sem a permissão transcricao (espião sem anfitrião vê, se tiver a permissão)", async () => {
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro", permissoes: { transcricao: false } });
    expect((await get()).status).toBe(403);
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro", permissoes: { anfitriao: false } });
    expect((await get()).status).toBe(200);
  });
});
