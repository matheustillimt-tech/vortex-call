import { describe, expect, it, vi } from "vitest";
import { registrarVenda } from "@/src/lib/vendas";
import type { VendaPay } from "@/src/lib/regras/venda-pay";

const VENDA: VendaPay = {
  orderId: "o1",
  status: "aprovada",
  valorCentavos: 9700,
  produto: "Mentoria",
  email: "ana@x.com",
  telefone: "+551138887777",
  compradaEm: "2026-10-23T12:00:00.000Z",
};

describe("registrarVenda", () => {
  it("chama registrar_venda com os campos certos e o payload normalizado (sem o corpo bruto)", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const db = { rpc } as unknown as Parameters<typeof registrarVenda>[0];
    await registrarVenda(db, VENDA);
    expect(rpc).toHaveBeenCalledWith("registrar_venda", {
      p_order_id: "o1",
      p_status: "aprovada",
      p_valor_centavos: 9700,
      p_produto: "Mentoria",
      p_email: "ana@x.com",
      p_whatsapp: "+551138887777",
      p_comprada_em: "2026-10-23T12:00:00.000Z",
      p_payload: {
        orderId: "o1",
        status: "aprovada",
        valorCentavos: 9700,
        produto: "Mentoria",
        email: "ana@x.com",
        telefone: "+551138887777",
        compradaEm: "2026-10-23T12:00:00.000Z",
      },
    });
  });

  it("erro na RPC sobe como erro", async () => {
    const rpc = vi.fn(async () => ({ error: { message: "falhou" } }));
    const db = { rpc } as unknown as Parameters<typeof registrarVenda>[0];
    await expect(registrarVenda(db, VENDA)).rejects.toThrow("Não foi possível registrar a venda.");
  });
});
