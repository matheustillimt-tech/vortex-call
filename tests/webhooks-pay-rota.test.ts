import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ marca: "db-admin-fake" }) }));
const registrarVenda = vi.fn(async (_db: unknown, _venda: unknown) => undefined);
const avisarCompra = vi.fn(async (_db: unknown, _filtro: unknown) => undefined);
vi.mock("@/src/lib/vendas", () => ({
  registrarVenda: (db: unknown, venda: unknown) => registrarVenda(db, venda),
  avisarCompra: (db: unknown, filtro: unknown) => avisarCompra(db, filtro),
}));

const TOKEN = "teste";

beforeEach(() => {
  registrarVenda.mockReset();
  registrarVenda.mockResolvedValue(undefined);
  avisarCompra.mockReset();
  delete process.env.PAY_WEBHOOK_TOKEN;
});

async function post(corpo: string, token = TOKEN) {
  const { POST } = await import("@/app/api/webhooks/pay/[token]/route");
  return POST(new Request("http://x", { method: "POST", body: corpo }), { params: Promise.resolve({ token }) });
}

// Payload real da Pay (formato Kiwify) com evento de compra aprovada.
const APROVADA = JSON.stringify({
  webhook_event_type: "compra_aprovada",
  order_id: "o1",
  order_status: "paid",
  Customer: { email: "ana@x.com", mobile: "+551138887777" },
  Commissions: { charge_amount: 9700 },
  Product: { product_name: "Mentoria" },
  created_at: "2026-10-23T12:00:00Z",
});

describe("POST /api/webhooks/pay/[token]", () => {
  it("404 sem PAY_WEBHOOK_TOKEN configurado, mesmo com o corpo certo", async () => {
    const r = await post(APROVADA);
    expect(r.status).toBe(404);
    expect(registrarVenda).not.toHaveBeenCalled();
  });

  it("404 com token errado", async () => {
    process.env.PAY_WEBHOOK_TOKEN = TOKEN;
    const r = await post(APROVADA, "token-errado");
    expect(r.status).toBe(404);
    expect(registrarVenda).not.toHaveBeenCalled();
  });

  it("200 { ok: true } e registra a venda com o token certo", async () => {
    process.env.PAY_WEBHOOK_TOKEN = TOKEN;
    const r = await post(APROVADA);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(registrarVenda).toHaveBeenCalledTimes(1);
    const [db, venda] = registrarVenda.mock.calls[0] as [unknown, unknown];
    expect(db).toEqual({ marca: "db-admin-fake" });
    expect(venda).toEqual(
      expect.objectContaining({ orderId: "o1", status: "aprovada", valorCentavos: 9700, email: "ana@x.com", telefone: "+551138887777" }),
    );
  });

  it("200 { ignorado: true } com corpo que não é JSON", async () => {
    process.env.PAY_WEBHOOK_TOKEN = TOKEN;
    const r = await post("não é json");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ignorado: true });
    expect(registrarVenda).not.toHaveBeenCalled();
  });

  it("200 { ignorado: true } com evento que não é compra aprovada nem reembolsada", async () => {
    process.env.PAY_WEBHOOK_TOKEN = TOKEN;
    const r = await post(JSON.stringify({ webhook_event_type: "pix_gerado", order_status: "waiting_payment" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ignorado: true });
    expect(registrarVenda).not.toHaveBeenCalled();
  });

  it("200 { ignorado: true } com corpo acima de 256 KB, sem tentar ler", async () => {
    process.env.PAY_WEBHOOK_TOKEN = TOKEN;
    const corpoGrande = JSON.stringify({ webhook_event_type: "compra_aprovada", order_status: "paid", recheio: "x".repeat(260 * 1024) });
    const r = await post(corpoGrande);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ignorado: true });
    expect(registrarVenda).not.toHaveBeenCalled();
  });

  it("500 quando não consegue registrar a venda", async () => {
    process.env.PAY_WEBHOOK_TOKEN = TOKEN;
    registrarVenda.mockRejectedValueOnce(new Error("falhou"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await post(APROVADA);
    expect(r.status).toBe(500);
    erro.mockRestore();
  });

  it("compra aprovada registrada avisa o CRM pelo pedido", async () => {
    process.env.PAY_WEBHOOK_TOKEN = TOKEN;
    const r = await post(APROVADA);
    expect(r.status).toBe(200);
    expect(avisarCompra).toHaveBeenCalledWith({ marca: "db-admin-fake" }, { orderId: "o1" });
  });

  it("reembolso não avisa compra", async () => {
    process.env.PAY_WEBHOOK_TOKEN = TOKEN;
    await post(JSON.stringify({ ...JSON.parse(APROVADA), webhook_event_type: "compra_reembolsada", order_status: "refunded" }));
    expect(avisarCompra).not.toHaveBeenCalled();
  });
});
