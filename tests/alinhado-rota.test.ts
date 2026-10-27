import { beforeEach, describe, expect, it, vi } from "vitest";

const SESS = "11111111-2222-4333-8444-555555555555";
const alinhamentoAoVivo = vi.fn<(s: string) => Promise<unknown>>(async () => ({ estado: "curto" }));
vi.mock("@/src/lib/alinhamento", () => ({ alinhamentoAoVivo: (s: string) => alinhamentoAoVivo(s) }));
const sessaoAceitaTrechos = vi.fn<(s: string) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/transcricao", () => ({ sessaoAceitaTrechos: (s: string) => sessaoAceitaTrechos(s) }));
const membroApi = vi.fn<() => Promise<{ id: string; nome: string; papel: string; permissoes?: Record<string, boolean> } | null>>(async () => null);
vi.mock("@/src/lib/supabase/usuario", () => ({ membroApi: () => membroApi() }));
const podeVerSessao = vi.fn<(quem: unknown, sessao: string) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/acesso", () => ({ podeVerSessao: (quem: unknown, sessao: string) => podeVerSessao(quem, sessao) }));

beforeEach(() => {
  alinhamentoAoVivo.mockClear();
  sessaoAceitaTrechos.mockReset();
  sessaoAceitaTrechos.mockResolvedValue(true);
  podeVerSessao.mockReset();
  podeVerSessao.mockResolvedValue(true);
  membroApi.mockReset();
  membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro" });
});

async function post(sessao = SESS) {
  const { POST } = await import("@/app/api/sala/alinhado/[sessao]/route");
  return POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ sessao }) });
}

describe("POST /api/sala/alinhado/[sessao]", () => {
  it("devolve o estado do alinhamento", async () => {
    const r = await post();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: "curto" });
    expect(alinhamentoAoVivo).toHaveBeenCalledWith(SESS);
  });
  it("401, 403 sem transcricao, 404 sem acesso ou id ruim, 409 se não transcreve", async () => {
    membroApi.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro", permissoes: { transcricao: false } });
    expect((await post()).status).toBe(403);
    membroApi.mockResolvedValue({ id: "m1", nome: "Bento", papel: "membro" });
    expect((await post("x")).status).toBe(404);
    podeVerSessao.mockResolvedValue(false);
    expect((await post()).status).toBe(404);
    podeVerSessao.mockResolvedValue(true);
    sessaoAceitaTrechos.mockResolvedValue(false);
    expect((await post()).status).toBe(409);
    expect(alinhamentoAoVivo).not.toHaveBeenCalled();
  });
});
