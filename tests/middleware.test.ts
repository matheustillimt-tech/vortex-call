import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createServerClient = vi.fn();
vi.mock("@supabase/ssr", () => ({ createServerClient: (...a: unknown[]) => createServerClient(...a) }));

beforeEach(() => {
  createServerClient.mockReset();
  createServerClient.mockReturnValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
});

function req(pathname: string) {
  return new NextRequest(new Request(`https://painel.x.com${pathname}`));
}

describe("middleware", () => {
  it("/.well-known/... devolve 404 em JSON sem tocar no Supabase", async () => {
    const { middleware } = await import("@/middleware");
    const r = await middleware(req("/.well-known/oauth-authorization-server"));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ erro: "não encontrado" });
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("rota fechada sem login redireciona pro /login (não é /.well-known)", async () => {
    const { middleware } = await import("@/middleware");
    const r = await middleware(req("/agendas"));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toContain("/login");
  });
});
