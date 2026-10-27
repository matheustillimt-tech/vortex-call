import { beforeEach, describe, expect, it, vi } from "vitest";

const estadoPorCodigo = vi.fn();
const passeConvidado = vi.fn();
const passeEquipe = vi.fn();
const encerrarSessao = vi.fn();
const statusDaSessao = vi.fn();
class ErroRtkFake extends Error {
  constructor(public status: number, public corpo: unknown) {
    super(`RealtimeKit respondeu ${status}`);
  }
}
class RegistroNaoEncontradoFake extends Error {}
class SessaoIndisponivelFake extends Error {
  constructor(public status: string) {
    super("Sessão não está disponível.");
  }
}
vi.mock("@/src/lib/sala", () => ({
  estadoPorCodigo: (c: string) => estadoPorCodigo(c),
  passeConvidado: (c: string) => passeConvidado(c),
  passeEquipe: (...a: unknown[]) => passeEquipe(...a),
  encerrarSessao: (s: string) => encerrarSessao(s),
  statusDaSessao: (s: string) => statusDaSessao(s),
  RegistroNaoEncontrado: RegistroNaoEncontradoFake,
  SessaoIndisponivel: SessaoIndisponivelFake,
}));
vi.mock("@/src/lib/realtimekit", () => ({ ErroRtk: ErroRtkFake }));

const dentroDoLimite = vi.fn<(chave: string, maximo: number) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/limite", () => ({ dentroDoLimite: (chave: string, maximo: number) => dentroDoLimite(chave, maximo) }));

const membroApi = vi.fn<() => Promise<{ id: string; nome: string; papel: string; permissoes?: Record<string, boolean> } | null>>(async () => null);
vi.mock("@/src/lib/supabase/usuario", () => ({ membroApi: () => membroApi() }));
const podeVerSessao = vi.fn<(quem: unknown, sessao: string) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/acesso", () => ({ podeVerSessao: (quem: unknown, sessao: string) => podeVerSessao(quem, sessao) }));

process.env.CRYPTO_KEY = "a".repeat(64);

beforeEach(() => {
  estadoPorCodigo.mockReset();
  passeConvidado.mockReset();
  passeEquipe.mockReset();
  encerrarSessao.mockReset();
  statusDaSessao.mockReset();
  dentroDoLimite.mockReset();
  dentroDoLimite.mockResolvedValue(true);
  membroApi.mockReset();
  membroApi.mockResolvedValue(null);
  podeVerSessao.mockReset();
  podeVerSessao.mockResolvedValue(true);
});

function req(corpo?: unknown) {
  return new Request("http://x", corpo === undefined ? undefined : { method: "POST", body: JSON.stringify(corpo) });
}

describe("GET /api/sala/estado/[codigo]", () => {
  it("404 quando não encontra", async () => {
    estadoPorCodigo.mockResolvedValue(null);
    const { GET } = await import("@/app/api/sala/estado/[codigo]/route");
    const r = await GET(req(), { params: Promise.resolve({ codigo: "naoexiste1" }) });
    expect(r.status).toBe(404);
  });
  it("200 sem nome nem whatsapp no corpo", async () => {
    estadoPorCodigo.mockResolvedValue({ estado: "espera", inicio: "2026-10-27T12:00:00.000Z", abreEm: "2026-10-27T11:55:00.000Z", slug: "vendas" });
    const { GET } = await import("@/app/api/sala/estado/[codigo]/route");
    const r = await GET(req(), { params: Promise.resolve({ codigo: "abcdefghjk" }) });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toEqual({ estado: "espera", inicio: "2026-10-27T12:00:00.000Z", abreEm: "2026-10-27T11:55:00.000Z", slug: "vendas" });
    expect(j.nome).toBeUndefined();
    expect(j.whatsapp).toBeUndefined();
  });
  it("429 no limite", async () => {
    dentroDoLimite.mockResolvedValue(false);
    const { GET } = await import("@/app/api/sala/estado/[codigo]/route");
    const r = await GET(req(), { params: Promise.resolve({ codigo: "abcdefghjk" }) });
    expect(r.status).toBe(429);
    expect(estadoPorCodigo).not.toHaveBeenCalled();
  });
});

describe("POST /api/sala/convidado/[codigo]", () => {
  it("409 quando não aberta", async () => {
    passeConvidado.mockResolvedValue({ estado: "espera" });
    const { POST } = await import("@/app/api/sala/convidado/[codigo]/route");
    const r = await POST(req(), { params: Promise.resolve({ codigo: "abcdefghjk" }) });
    expect(r.status).toBe(409);
    expect((await r.json()).estado).toBe("espera");
  });
  it("200 com token", async () => {
    passeConvidado.mockResolvedValue({ passe: { token: "tok", nome: "Ana", papel: "convidado" }, estado: "aberta" });
    const { POST } = await import("@/app/api/sala/convidado/[codigo]/route");
    const r = await POST(req(), { params: Promise.resolve({ codigo: "abcdefghjk" }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ token: "tok", nome: "Ana", papel: "convidado" });
  });
  it("404 código inexistente", async () => {
    passeConvidado.mockRejectedValue(new RegistroNaoEncontradoFake());
    const { POST } = await import("@/app/api/sala/convidado/[codigo]/route");
    const r = await POST(req(), { params: Promise.resolve({ codigo: "naoexiste1" }) });
    expect(r.status).toBe(404);
  });
  it("429 no limite", async () => {
    dentroDoLimite.mockResolvedValue(false);
    const { POST } = await import("@/app/api/sala/convidado/[codigo]/route");
    const r = await POST(req(), { params: Promise.resolve({ codigo: "abcdefghjk" }) });
    expect(r.status).toBe(429);
    expect(passeConvidado).not.toHaveBeenCalled();
  });
  it("502 quando o RealtimeKit falha", async () => {
    passeConvidado.mockRejectedValue(new ErroRtkFake(500, {}));
    const { POST } = await import("@/app/api/sala/convidado/[codigo]/route");
    const r = await POST(req(), { params: Promise.resolve({ codigo: "abcdefghjk" }) });
    expect(r.status).toBe(502);
    expect((await r.json()).erro).toBe("Não conseguimos abrir a sala. Tente de novo.");
  });
  it("chama dentroDoLimite com a chave sala-convidado e máximo 20", async () => {
    passeConvidado.mockResolvedValue({ estado: "espera" });
    const { POST } = await import("@/app/api/sala/convidado/[codigo]/route");
    await POST(req(), { params: Promise.resolve({ codigo: "abcdefghjk" }) });
    expect(dentroDoLimite).toHaveBeenCalledWith(expect.stringMatching(/^sala-convidado:/), 20);
  });
});

describe("POST /api/sala/equipe/[sessao]", () => {
  it("401 sem membro", async () => {
    membroApi.mockResolvedValue(null);
    const { POST } = await import("@/app/api/sala/equipe/[sessao]/route");
    const r = await POST(req({ modo: "anfitriao" }), { params: Promise.resolve({ sessao: "sess1" }) });
    expect(r.status).toBe(401);
  });
  it("400 modo inválido", async () => {
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro" });
    const { POST } = await import("@/app/api/sala/equipe/[sessao]/route");
    const r = await POST(req({ modo: "espectador" }), { params: Promise.resolve({ sessao: "sess1" }) });
    expect(r.status).toBe(400);
  });
  it("200 com membro e modo válido", async () => {
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro" });
    passeEquipe.mockResolvedValue({ token: "tok", nome: "Bento", papel: "anfitriao" });
    const { POST } = await import("@/app/api/sala/equipe/[sessao]/route");
    const r = await POST(req({ modo: "anfitriao" }), { params: Promise.resolve({ sessao: "sess1" }) });
    expect(r.status).toBe(200);
    expect(passeEquipe).toHaveBeenCalledWith("sess1", { id: "m1", nome: "Bento" }, "anfitriao");
    expect(await r.json()).toEqual({ token: "tok", nome: "Bento", papel: "anfitriao" });
  });
  it("409 quando a sessão não está disponível", async () => {
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro" });
    passeEquipe.mockRejectedValue(new SessaoIndisponivelFake("encerrada"));
    const { POST } = await import("@/app/api/sala/equipe/[sessao]/route");
    const r = await POST(req({ modo: "anfitriao" }), { params: Promise.resolve({ sessao: "sess1" }) });
    expect(r.status).toBe(409);
  });
});

describe("POST /api/sala/encerrar/[sessao]", () => {
  it("401 sem membro", async () => {
    membroApi.mockResolvedValue(null);
    const { POST } = await import("@/app/api/sala/encerrar/[sessao]/route");
    const r = await POST(req(), { params: Promise.resolve({ sessao: "sess1" }) });
    expect(r.status).toBe(401);
    expect(encerrarSessao).not.toHaveBeenCalled();
  });
  const UUID = "0b6f3c1e-8f7a-4a43-9a2e-3f1d2c4b5a69";
  it("200 com membro", async () => {
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "admin" });
    encerrarSessao.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/sala/encerrar/[sessao]/route");
    const r = await POST(req(), { params: Promise.resolve({ sessao: UUID }) });
    expect(r.status).toBe(200);
    expect(encerrarSessao).toHaveBeenCalledWith(UUID);
  });
  it("404 com id que não é uuid, sem chamar o banco", async () => {
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "admin" });
    const { POST } = await import("@/app/api/sala/encerrar/[sessao]/route");
    const r = await POST(req(), { params: Promise.resolve({ sessao: "nao-e-uuid" }) });
    expect(r.status).toBe(404);
    expect(encerrarSessao).not.toHaveBeenCalled();
  });
  it("404 com sessão inexistente", async () => {
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "admin" });
    encerrarSessao.mockRejectedValue(new RegistroNaoEncontradoFake());
    const { POST } = await import("@/app/api/sala/encerrar/[sessao]/route");
    const r = await POST(req(), { params: Promise.resolve({ sessao: UUID }) });
    expect(r.status).toBe(404);
  });
  it("409 com sessão já encerrada ou cancelada", async () => {
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "admin" });
    encerrarSessao.mockRejectedValue(new SessaoIndisponivelFake("encerrada"));
    const { POST } = await import("@/app/api/sala/encerrar/[sessao]/route");
    const r = await POST(req(), { params: Promise.resolve({ sessao: UUID }) });
    expect(r.status).toBe(409);
    expect((await r.json()).erro).toEqual(expect.any(String));
  });
});

describe("GET /api/sala/equipe/[sessao]", () => {
  const UUID = "0b6f3c1e-8f7a-4a43-9a2e-3f1d2c4b5a69";
  it("401 sem membro", async () => {
    const { GET } = await import("@/app/api/sala/equipe/[sessao]/route");
    const r = await GET(req(), { params: Promise.resolve({ sessao: UUID }) });
    expect(r.status).toBe(401);
    expect(statusDaSessao).not.toHaveBeenCalled();
  });
  it("404 com id que não é uuid, sem chamar o banco", async () => {
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro" });
    const { GET } = await import("@/app/api/sala/equipe/[sessao]/route");
    const r = await GET(req(), { params: Promise.resolve({ sessao: "sess1" }) });
    expect(r.status).toBe(404);
    expect(statusDaSessao).not.toHaveBeenCalled();
  });
  it("404 com sessão inexistente", async () => {
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro" });
    statusDaSessao.mockResolvedValue(null);
    const { GET } = await import("@/app/api/sala/equipe/[sessao]/route");
    const r = await GET(req(), { params: Promise.resolve({ sessao: UUID }) });
    expect(r.status).toBe(404);
  });
  it("200 com o status da sessão", async () => {
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro" });
    statusDaSessao.mockResolvedValue("encerrada");
    const { GET } = await import("@/app/api/sala/equipe/[sessao]/route");
    const r = await GET(req(), { params: Promise.resolve({ sessao: UUID }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "encerrada" });
  });
});

describe("recorte por agenda (vendedor de outra agenda)", () => {
  const UUID = "0b6f3c1e-8f7a-4a43-9a2e-3f1d2c4b5a69";
  const OLAVO = { id: "m-olavo", nome: "Olavo", papel: "membro" };

  it("POST /api/sala/equipe: 404 sem entrar (anfitrião e espião)", async () => {
    membroApi.mockResolvedValue(OLAVO);
    podeVerSessao.mockResolvedValue(false);
    const { POST } = await import("@/app/api/sala/equipe/[sessao]/route");
    for (const modo of ["anfitriao", "espiao"]) {
      const r = await POST(req({ modo }), { params: Promise.resolve({ sessao: UUID }) });
      expect(r.status).toBe(404);
    }
    expect(podeVerSessao).toHaveBeenCalledWith(OLAVO, UUID);
    expect(passeEquipe).not.toHaveBeenCalled();
  });

  it("GET /api/sala/equipe: 404 sem ler o status", async () => {
    membroApi.mockResolvedValue(OLAVO);
    podeVerSessao.mockResolvedValue(false);
    const { GET } = await import("@/app/api/sala/equipe/[sessao]/route");
    expect((await GET(req(), { params: Promise.resolve({ sessao: UUID }) })).status).toBe(404);
    expect(statusDaSessao).not.toHaveBeenCalled();
  });

  it("POST /api/sala/encerrar: 404 sem encerrar", async () => {
    membroApi.mockResolvedValue(OLAVO);
    podeVerSessao.mockResolvedValue(false);
    const { POST } = await import("@/app/api/sala/encerrar/[sessao]/route");
    expect((await POST(req(), { params: Promise.resolve({ sessao: UUID }) })).status).toBe(404);
    expect(encerrarSessao).not.toHaveBeenCalled();
  });
});

describe("permissões de entrada na sala (anfitrião e espião)", () => {
  const BENTO = { id: "m1", nome: "Bento", papel: "membro" };

  it("sem anfitriao: 403 como anfitrião, mas entra como espião", async () => {
    membroApi.mockResolvedValue({ ...BENTO, permissoes: { anfitriao: false } });
    passeEquipe.mockResolvedValue({ token: "tok", nome: "Bento", papel: "espiao" });
    const { POST } = await import("@/app/api/sala/equipe/[sessao]/route");
    const r = await POST(req({ modo: "anfitriao" }), { params: Promise.resolve({ sessao: "sess1" }) });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erro: "Você não tem permissão pra isso. Fale com o admin." });
    expect(passeEquipe).not.toHaveBeenCalled();
    expect((await POST(req({ modo: "espiao" }), { params: Promise.resolve({ sessao: "sess1" }) })).status).toBe(200);
  });

  it("sem espiao: 403 como espião", async () => {
    membroApi.mockResolvedValue({ ...BENTO, permissoes: { espiao: false } });
    const { POST } = await import("@/app/api/sala/equipe/[sessao]/route");
    expect((await POST(req({ modo: "espiao" }), { params: Promise.resolve({ sessao: "sess1" }) })).status).toBe(403);
    expect(passeEquipe).not.toHaveBeenCalled();
  });

  it("admin entra mesmo com as chaves desligadas no jsonb", async () => {
    membroApi.mockResolvedValue({ id: "a", nome: "Gus", papel: "admin", permissoes: { anfitriao: false, espiao: false } });
    passeEquipe.mockResolvedValue({ token: "tok", nome: "Gus", papel: "anfitriao" });
    const { POST } = await import("@/app/api/sala/equipe/[sessao]/route");
    expect((await POST(req({ modo: "anfitriao" }), { params: Promise.resolve({ sessao: "sess1" }) })).status).toBe(200);
  });
});

describe("encerrar a sessão exige anfitriao", () => {
  const UUID = "0b6f3c1e-8f7a-4a43-9a2e-3f1d2c4b5a69";
  it("membro só com espião: 403 sem encerrar; admin encerra", async () => {
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro", permissoes: { anfitriao: false } });
    const { POST } = await import("@/app/api/sala/encerrar/[sessao]/route");
    expect((await POST(req(), { params: Promise.resolve({ sessao: UUID }) })).status).toBe(403);
    expect(encerrarSessao).not.toHaveBeenCalled();
    membroApi.mockResolvedValue({ id: "a", nome: "Gus", papel: "admin", permissoes: { anfitriao: false } });
    expect((await POST(req(), { params: Promise.resolve({ sessao: UUID }) })).status).toBe(200);
  });
});
