import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const deleteMock = vi.fn();
const lt = vi.fn();
function tabela() {
  const q = { delete: (...a: unknown[]) => { deleteMock(...a); return q; }, lt: async (...a: unknown[]) => lt(...a) };
  return q;
}
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ rpc, from: () => tabela() }) }));

import { dentroDoLimite, limparLimites } from "@/src/lib/limite";

beforeEach(() => {
  rpc.mockReset();
  deleteMock.mockReset();
  lt.mockReset();
  lt.mockResolvedValue({ error: null, count: 0 });
});

describe("dentroDoLimite", () => {
  it("dentro do máximo devolve true", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    expect(await dentroDoLimite("chave", 10)).toBe(true);
  });

  it("acima do máximo devolve false", async () => {
    rpc.mockResolvedValue({ data: 11, error: null });
    expect(await dentroDoLimite("chave", 10)).toBe(false);
  });

  it("erro na RPC não bloqueia (devolve true)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "falhou" } });
    expect(await dentroDoLimite("chave", 10)).toBe(true);
  });
});

describe("limparLimites", () => {
  it("apaga janelas com mais de 1 hora e devolve quantas apagou", async () => {
    lt.mockResolvedValue({ error: null, count: 7 });
    const agora = new Date("2026-10-27T12:30:00Z");
    expect(await limparLimites(agora)).toBe(7);
    expect(lt).toHaveBeenCalledWith("janela", "2026-10-27T11:30:00.000Z");
  });

  it("erro no banco não quebra (devolve 0)", async () => {
    lt.mockResolvedValue({ error: { message: "falhou" }, count: null });
    expect(await limparLimites(new Date())).toBe(0);
  });
});
