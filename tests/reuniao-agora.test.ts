import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const local = { href: "" };
let agendados: { fn: () => void; ms: number }[] = [];

beforeEach(() => {
  local.href = "";
  agendados = [];
  vi.stubGlobal("window", {
    location: local,
    setTimeout: (fn: () => void, ms: number) => {
      agendados.push({ fn, ms });
      return 1;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

function respostaFetch(status: number, corpo: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => corpo })));
}

describe("criarEAbrirReuniao", () => {
  it("sucesso: abre /r/{codigo} na mesma aba e não devolve erro", async () => {
    respostaFetch(200, { codigo: "abcdefghjk", link: "https://x/r/abcdefghjk" });
    const { criarEAbrirReuniao } = await import("@/app/(painel)/_componentes/reuniao-agora");
    expect(await criarEAbrirReuniao()).toBeNull();
    expect(local.href).toBe("/r/abcdefghjk");
  });
  it("401: avisa que a sessão expirou e, depois do aviso, manda pro /login", async () => {
    respostaFetch(401, { erro: "não autenticado" });
    const { criarEAbrirReuniao } = await import("@/app/(painel)/_componentes/reuniao-agora");
    expect(await criarEAbrirReuniao()).toBe("Sua sessão expirou. Faça login de novo.");
    expect(local.href).toBe("");
    expect(agendados).toHaveLength(1);
    expect(agendados[0].ms).toBeGreaterThan(0);
    agendados[0].fn();
    expect(local.href).toBe("/login");
  });
  it("outro erro: devolve a mensagem do servidor e não redireciona", async () => {
    respostaFetch(502, { erro: "Não conseguimos criar a sala. Tente de novo." });
    const { criarEAbrirReuniao } = await import("@/app/(painel)/_componentes/reuniao-agora");
    expect(await criarEAbrirReuniao()).toBe("Não conseguimos criar a sala. Tente de novo.");
    expect(agendados).toHaveLength(0);
    expect(local.href).toBe("");
  });
});
