import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErroApi } from "@/src/lib/api/http";

const linkGravacao = vi.fn();
vi.mock("@/src/lib/api/gravacoes", () => ({ linkGravacao: (...a: unknown[]) => linkGravacao(...a) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({}) }));

type M = { id: string; nome: string; papel: string; permissoes?: Record<string, boolean> } | null;
const membroApi = vi.fn<() => Promise<M>>(async () => null);
vi.mock("@/src/lib/supabase/usuario", () => ({ membroApi: () => membroApi() }));

const podeVerGravacao = vi.fn<(quem: unknown, id: string) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/acesso", () => ({ podeVerGravacao: (quem: unknown, id: string) => podeVerGravacao(quem, id) }));

const ID = "11111111-1111-4111-8111-111111111111";
const BENTO = { id: "memb1", nome: "Bento", papel: "membro" };

beforeEach(() => {
  linkGravacao.mockReset();
  membroApi.mockReset();
  membroApi.mockResolvedValue(null);
  podeVerGravacao.mockReset();
  podeVerGravacao.mockResolvedValue(true);
});

describe("gravação de outra agenda", () => {
  it("vira a página de indisponível (404), sem gerar link", async () => {
    membroApi.mockResolvedValue(BENTO);
    podeVerGravacao.mockResolvedValue(false);
    const { GET } = await import("@/app/api/gravacoes/[id]/link/route");
    const r = await GET(new Request("http://x"), get());
    expect(r.status).toBe(404);
    expect(podeVerGravacao).toHaveBeenCalledWith(BENTO, ID);
    expect(linkGravacao).not.toHaveBeenCalled();
  });
});

function get(id = ID) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/gravacoes/[id]/link", () => {
  it("401 sem login", async () => {
    const { GET } = await import("@/app/api/gravacoes/[id]/link/route");
    const r = await GET(new Request("http://x"), get());
    expect(r.status).toBe(401);
    expect(linkGravacao).not.toHaveBeenCalled();
  });

  it("302 pro link quando está tudo certo, com cache-control: no-store", async () => {
    membroApi.mockResolvedValue(BENTO);
    linkGravacao.mockResolvedValue({ url: "https://cdn.rtk.test/arquivo.mp4", expira: null });
    const { GET } = await import("@/app/api/gravacoes/[id]/link/route");
    const r = await GET(new Request("http://x"), get());
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://cdn.rtk.test/arquivo.mp4");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("link que não é https vira a página de indisponível (nunca redireciona pra http:// ou outro protocolo)", async () => {
    membroApi.mockResolvedValue(BENTO);
    linkGravacao.mockResolvedValue({ url: "http://cdn.rtk.test/arquivo.mp4", expira: null });
    const { GET } = await import("@/app/api/gravacoes/[id]/link/route");
    const r = await GET(new Request("http://x"), get());
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toContain("text/html");
  });

  it("?baixar=1 também redireciona e pede o link de download (R2 usa no content-disposition)", async () => {
    membroApi.mockResolvedValue(BENTO);
    linkGravacao.mockResolvedValue({ url: "https://cdn.rtk.test/arquivo.mp4", expira: null });
    const { GET } = await import("@/app/api/gravacoes/[id]/link/route");
    const r = await GET(new Request("http://x/?baixar=1"), get());
    expect(r.status).toBe(302);
    expect(linkGravacao).toHaveBeenCalledWith(expect.anything(), ID, expect.any(Date), { baixar: true });
    expect(r.headers.get("location")).toBe("https://cdn.rtk.test/arquivo.mp4");
  });

  it("404 (expirada ou inexistente) vira a página de indisponível em HTML", async () => {
    membroApi.mockResolvedValue(BENTO);
    linkGravacao.mockRejectedValue(new ErroApi(404, "Gravação indisponível."));
    const { GET } = await import("@/app/api/gravacoes/[id]/link/route");
    const r = await GET(new Request("http://x"), get());
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(await r.text()).toContain("expirou");
  });

  it("id que não é uuid também vira a página de indisponível, sem ir ao banco", async () => {
    membroApi.mockResolvedValue(BENTO);
    const { GET } = await import("@/app/api/gravacoes/[id]/link/route");
    const r = await GET(new Request("http://x"), get("nao-uuid"));
    expect(r.status).toBe(404);
    expect(linkGravacao).not.toHaveBeenCalled();
  });

  it("502 quando o RealtimeKit falha", async () => {
    membroApi.mockResolvedValue(BENTO);
    linkGravacao.mockRejectedValue(new ErroApi(502, "Não deu para buscar o link agora. Tente de novo."));
    const { GET } = await import("@/app/api/gravacoes/[id]/link/route");
    const r = await GET(new Request("http://x"), get());
    expect(r.status).toBe(502);
  });
});

describe("permissão gravacoes", () => {
  it("sem gravacoes: 403 sem nem consultar a gravação", async () => {
    membroApi.mockResolvedValue({ ...BENTO, permissoes: { gravacoes: false } } as M);
    const { GET } = await import("@/app/api/gravacoes/[id]/link/route");
    const r = await GET(new Request("http://x?baixar=1"), get());
    expect(r.status).toBe(403);
    expect(await r.text()).toBe("Você não tem permissão pra isso. Fale com o admin.");
    expect(podeVerGravacao).not.toHaveBeenCalled();
    expect(linkGravacao).not.toHaveBeenCalled();
  });
});
