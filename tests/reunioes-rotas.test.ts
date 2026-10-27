import { beforeEach, describe, expect, it, vi } from "vitest";

const criarReuniao = vi.fn();
const estadoReuniao = vi.fn();
const passeReuniaoMembro = vi.fn();
const passeReuniaoVisitante = vi.fn();
const encerrarReuniao = vi.fn();
class ErroRtkFake extends Error {
  constructor(public status: number, public corpo: unknown) {
    super(`RealtimeKit respondeu ${status}`);
  }
}
class RegistroNaoEncontradoFake extends Error {}
class ReuniaoEncerradaFake extends Error {}
vi.mock("@/src/lib/reunioes", () => ({
  criarReuniao: (...a: unknown[]) => criarReuniao(...a),
  estadoReuniao: (...a: unknown[]) => estadoReuniao(...a),
  passeReuniaoMembro: (...a: unknown[]) => passeReuniaoMembro(...a),
  passeReuniaoVisitante: (...a: unknown[]) => passeReuniaoVisitante(...a),
  encerrarReuniao: (...a: unknown[]) => encerrarReuniao(...a),
  ReuniaoEncerrada: ReuniaoEncerradaFake,
}));
vi.mock("@/src/lib/sala", () => ({ RegistroNaoEncontrado: RegistroNaoEncontradoFake }));
vi.mock("@/src/lib/realtimekit", () => ({ ErroRtk: ErroRtkFake }));

const dentroDoLimite = vi.fn<(chave: string, maximo: number) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/limite", () => ({ dentroDoLimite: (chave: string, maximo: number) => dentroDoLimite(chave, maximo) }));

type M = { id: string; nome: string; papel: string; permissoes?: Record<string, boolean> } | null;
const membroApi = vi.fn<() => Promise<M>>(async () => null);
vi.mock("@/src/lib/supabase/usuario", () => ({ membroApi: () => membroApi() }));

process.env.CRYPTO_KEY = "a".repeat(64);
process.env.NEXT_PUBLIC_SITE_URL = "https://call.exemplo.com.br/";

const BENTO = { id: "memb1", nome: "Bento", papel: "membro" };
const VISITANTE = "0f8fad5b-d9cb-469f-a165-70867728950e";
const cod = () => ({ params: Promise.resolve({ codigo: "abcdefghjk" }) });

beforeEach(() => {
  for (const f of [criarReuniao, estadoReuniao, passeReuniaoMembro, passeReuniaoVisitante, encerrarReuniao]) f.mockReset();
  dentroDoLimite.mockReset();
  dentroDoLimite.mockResolvedValue(true);
  membroApi.mockReset();
  membroApi.mockResolvedValue(null);
});

function post(corpo?: unknown, ip = "1.2.3.4") {
  return new Request("http://x", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

describe("POST /api/reunioes", () => {
  it("401 sem login", async () => {
    const { POST } = await import("@/app/api/reunioes/route");
    const r = await POST(post({}));
    expect(r.status).toBe(401);
    expect(criarReuniao).not.toHaveBeenCalled();
  });
  it("200 com código e link /r/{codigo} (sem barra dupla)", async () => {
    membroApi.mockResolvedValue(BENTO);
    criarReuniao.mockResolvedValue({ codigo: "abcdefghjk" });
    const { POST } = await import("@/app/api/reunioes/route");
    const r = await POST(post({ titulo: "Alinhamento" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ codigo: "abcdefghjk", link: "https://call.exemplo.com.br/r/abcdefghjk" });
    expect(criarReuniao).toHaveBeenCalledWith({ id: "memb1", nome: "Bento", papel: "membro" }, "Alinhamento");
  });
  it("sem corpo (ou corpo inválido) cria com título padrão", async () => {
    membroApi.mockResolvedValue(BENTO);
    criarReuniao.mockResolvedValue({ codigo: "abcdefghjk" });
    const { POST } = await import("@/app/api/reunioes/route");
    expect((await POST(post())).status).toBe(200);
    expect((await POST(post("{nao json"))).status).toBe(200);
    expect((await POST(post({ titulo: 42 }))).status).toBe(200);
    for (const chamada of criarReuniao.mock.calls) expect(chamada[1]).toBeUndefined();
  });
  it("502 quando o RealtimeKit falha", async () => {
    membroApi.mockResolvedValue(BENTO);
    criarReuniao.mockRejectedValue(new ErroRtkFake(500, {}));
    const { POST } = await import("@/app/api/reunioes/route");
    expect((await POST(post({}))).status).toBe(502);
  });
});

describe("GET /api/reunioes/estado/[codigo]", () => {
  it("404 quando não encontra", async () => {
    estadoReuniao.mockResolvedValue(null);
    const { GET } = await import("@/app/api/reunioes/estado/[codigo]/route");
    expect((await GET(new Request("http://x"), cod())).status).toBe(404);
  });
  it("200 só com estado e título (nenhum dado pessoal)", async () => {
    estadoReuniao.mockResolvedValue({ estado: "ativa", titulo: "Alinhamento" });
    const { GET } = await import("@/app/api/reunioes/estado/[codigo]/route");
    const r = await GET(new Request("http://x"), cod());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: "ativa", titulo: "Alinhamento" });
  });
  it("429 no limite", async () => {
    dentroDoLimite.mockResolvedValue(false);
    const { GET } = await import("@/app/api/reunioes/estado/[codigo]/route");
    expect((await GET(new Request("http://x"), cod())).status).toBe(429);
    expect(estadoReuniao).not.toHaveBeenCalled();
  });
});

describe("POST /api/reunioes/entrar/[codigo]", () => {
  it("membro logado: ignora o corpo e devolve passe de anfitrião, sem limite de visitante", async () => {
    membroApi.mockResolvedValue(BENTO);
    passeReuniaoMembro.mockResolvedValue({ token: "tok", nome: "Bento", papel: "anfitriao" });
    const { POST } = await import("@/app/api/reunioes/entrar/[codigo]/route");
    const r = await POST(post({ nome: "x" }), cod());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ token: "tok", nome: "Bento", papel: "anfitriao" });
    expect(passeReuniaoMembro).toHaveBeenCalledWith("abcdefghjk", { id: "memb1", nome: "Bento" });
    expect(passeReuniaoVisitante).not.toHaveBeenCalled();
    expect(dentroDoLimite).not.toHaveBeenCalled();
  });
  it("visitante: 200 com passe de participante, nome sem espaços nas pontas", async () => {
    passeReuniaoVisitante.mockResolvedValue({ token: "tok", nome: "Ana", papel: "participante" });
    const { POST } = await import("@/app/api/reunioes/entrar/[codigo]/route");
    const r = await POST(post({ nome: "  Ana  ", visitanteId: VISITANTE }), cod());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ token: "tok", nome: "Ana", papel: "participante" });
    expect(passeReuniaoVisitante).toHaveBeenCalledWith("abcdefghjk", "Ana", VISITANTE);
  });
  it("visitante: limite 20/min por IP com a chave reuniao-visitante:<hash>", async () => {
    passeReuniaoVisitante.mockResolvedValue({ token: "tok", nome: "Ana", papel: "participante" });
    const { POST } = await import("@/app/api/reunioes/entrar/[codigo]/route");
    await POST(post({ nome: "Ana", visitanteId: VISITANTE }), cod());
    expect(dentroDoLimite).toHaveBeenCalledWith(expect.stringMatching(/^reuniao-visitante:[0-9a-f]+$/), 20);
    expect(dentroDoLimite.mock.calls[0][0]).not.toContain("1.2.3.4");
  });
  it("visitante: 429 no limite, sem pedir passe", async () => {
    dentroDoLimite.mockResolvedValue(false);
    const { POST } = await import("@/app/api/reunioes/entrar/[codigo]/route");
    const r = await POST(post({ nome: "Ana", visitanteId: VISITANTE }), cod());
    expect(r.status).toBe(429);
    expect(passeReuniaoVisitante).not.toHaveBeenCalled();
  });
  it("visitante: 400 com nome inválido ou visitanteId que não é uuid", async () => {
    const { POST } = await import("@/app/api/reunioes/entrar/[codigo]/route");
    for (const corpo of [
      { nome: "A", visitanteId: VISITANTE },
      { nome: "   ", visitanteId: VISITANTE },
      { nome: "a".repeat(61), visitanteId: VISITANTE },
      { visitanteId: VISITANTE },
      { nome: "Ana", visitanteId: "nao-uuid" },
      { nome: "Ana" },
    ]) {
      expect((await POST(post(corpo), cod())).status).toBe(400);
    }
    expect((await POST(post("{nao json"), cod())).status).toBe(400);
    expect(passeReuniaoVisitante).not.toHaveBeenCalled();
  });
  it("404 inexistente, 409 encerrada, 502 RealtimeKit", async () => {
    const { POST } = await import("@/app/api/reunioes/entrar/[codigo]/route");
    passeReuniaoVisitante.mockRejectedValueOnce(new RegistroNaoEncontradoFake());
    expect((await POST(post({ nome: "Ana", visitanteId: VISITANTE }), cod())).status).toBe(404);
    passeReuniaoVisitante.mockRejectedValueOnce(new ReuniaoEncerradaFake());
    const r409 = await POST(post({ nome: "Ana", visitanteId: VISITANTE }), cod());
    expect(r409.status).toBe(409);
    expect((await r409.json()).estado).toBe("encerrada");
    passeReuniaoVisitante.mockRejectedValueOnce(new ErroRtkFake(500, {}));
    expect((await POST(post({ nome: "Ana", visitanteId: VISITANTE }), cod())).status).toBe(502);
  });
  it("membro logado com reunião encerrada também recebe 409", async () => {
    membroApi.mockResolvedValue(BENTO);
    passeReuniaoMembro.mockRejectedValue(new ReuniaoEncerradaFake());
    const { POST } = await import("@/app/api/reunioes/entrar/[codigo]/route");
    expect((await POST(post(), cod())).status).toBe(409);
  });
});

describe("POST /api/reunioes/encerrar/[codigo]", () => {
  it("401 sem login", async () => {
    const { POST } = await import("@/app/api/reunioes/encerrar/[codigo]/route");
    expect((await POST(post(), cod())).status).toBe(401);
    expect(encerrarReuniao).not.toHaveBeenCalled();
  });
  it("200 encerra com o membro logado", async () => {
    membroApi.mockResolvedValue(BENTO);
    const { POST } = await import("@/app/api/reunioes/encerrar/[codigo]/route");
    const r = await POST(post(), cod());
    expect(r.status).toBe(200);
    expect(encerrarReuniao).toHaveBeenCalledWith("abcdefghjk", BENTO);
  });
  it("404, 409 e 502", async () => {
    membroApi.mockResolvedValue(BENTO);
    const { POST } = await import("@/app/api/reunioes/encerrar/[codigo]/route");
    encerrarReuniao.mockRejectedValueOnce(new RegistroNaoEncontradoFake());
    expect((await POST(post(), cod())).status).toBe(404);
    encerrarReuniao.mockRejectedValueOnce(new ReuniaoEncerradaFake());
    expect((await POST(post(), cod())).status).toBe(409);
    encerrarReuniao.mockRejectedValueOnce(new ErroRtkFake(500, {}));
    expect((await POST(post(), cod())).status).toBe(502);
  });
});

describe("permissão reunioes", () => {
  it("sem reunioes: 403 ao criar, mas entra numa reunião que já existe", async () => {
    membroApi.mockResolvedValue({ ...BENTO, permissoes: { reunioes: false } });
    const { POST } = await import("@/app/api/reunioes/route");
    const r = await POST(post({}));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erro: "Você não tem permissão pra isso. Fale com o admin." });
    expect(criarReuniao).not.toHaveBeenCalled();
    passeReuniaoMembro.mockResolvedValue({ token: "tok", nome: "Bento", papel: "anfitriao" });
    const { POST: entrar } = await import("@/app/api/reunioes/entrar/[codigo]/route");
    expect((await entrar(post({}), cod())).status).toBe(200);
  });
});
