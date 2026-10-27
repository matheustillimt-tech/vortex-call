import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizarVendaPay } from "@/src/lib/regras/venda-pay";

const AGORA = () => new Date("2026-10-23T12:00:00Z");

// Webhook no formato da Kiwify (payload resumido da doc).
const pedido = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    webhook_event_type: "compra_aprovada",
    order_id: "cmote04g1n0001kqkrxr8c4l",
    order_status: "paid",
    Customer: { full_name: "João da Silva", email: "Joao@Exemplo.com", mobile: "+551138887777" },
    Commissions: { charge_amount: 9700, currency: "BRL" },
    Product: { product_id: "prod_1", product_name: "Mentoria Exemplo" },
    created_at: "2026-10-23T11:30:00Z",
    access_token: "tok-123",
    ...extra,
  });

describe("normalizarVendaPay: compra aprovada", () => {
  // Servidor em UTC (como na Vercel): sem isso, num Mac em Brasília o `new Date()` acertaria o fuso por acaso.
  let tzAntes: string | undefined;
  beforeAll(() => {
    tzAntes = process.env.TZ;
    process.env.TZ = "UTC";
  });
  afterAll(() => {
    if (tzAntes === undefined) delete process.env.TZ;
    else process.env.TZ = tzAntes;
  });

  it("aceita e normaliza valor em centavos, comprador, produto e data", () => {
    expect(normalizarVendaPay(pedido(), AGORA)).toEqual({
      resultado: "aceita",
      venda: {
        orderId: "cmote04g1n0001kqkrxr8c4l",
        status: "aprovada",
        valorCentavos: 9700,
        produto: "Mentoria Exemplo",
        email: "joao@exemplo.com",
        telefone: "+551138887777",
        compradaEm: "2026-10-23T11:30:00.000Z",
      },
    });
  });

  it("sem created_at: usa agora", () => {
    const r = normalizarVendaPay(pedido({ created_at: undefined }), AGORA);
    expect(r.resultado === "aceita" && r.venda.compradaEm).toBe("2026-10-23T12:00:00.000Z");
  });

  it("created_at no formato da Kiwify sem fuso (\"YYYY-MM-DD HH:mm\"): lido como horário de Brasília", () => {
    const r = normalizarVendaPay(pedido({ created_at: "2026-10-23 08:30" }), AGORA);
    expect(r.resultado === "aceita" && r.venda.compradaEm).toBe("2026-10-23T11:30:00.000Z");
  });

  it("created_at sem fuso com segundos (e com T): lido como horário de Brasília", () => {
    const r1 = normalizarVendaPay(pedido({ created_at: "2026-10-23 21:15:42" }), AGORA);
    expect(r1.resultado === "aceita" && r1.venda.compradaEm).toBe("2026-10-24T00:15:42.000Z");
    const r2 = normalizarVendaPay(pedido({ created_at: "2026-10-23T08:30:00" }), AGORA);
    expect(r2.resultado === "aceita" && r2.venda.compradaEm).toBe("2026-10-23T11:30:00.000Z");
  });

  it("created_at com fuso explícito: respeita o fuso", () => {
    const r = normalizarVendaPay(pedido({ created_at: "2026-10-23T08:30:00-03:00" }), AGORA);
    expect(r.resultado === "aceita" && r.venda.compradaEm).toBe("2026-10-23T11:30:00.000Z");
    const r2 = normalizarVendaPay(pedido({ created_at: "2026-10-23T11:30:00.000+00:00" }), AGORA);
    expect(r2.resultado === "aceita" && r2.venda.compradaEm).toBe("2026-10-23T11:30:00.000Z");
  });

  it("created_at inválido: usa agora", () => {
    const r = normalizarVendaPay(pedido({ created_at: "não é data" }), AGORA);
    expect(r.resultado === "aceita" && r.venda.compradaEm).toBe("2026-10-23T12:00:00.000Z");
  });

  it("sem produto: null", () => {
    const r = normalizarVendaPay(pedido({ Product: undefined }), AGORA);
    expect(r.resultado === "aceita" && r.venda.produto).toBeNull();
  });

  it("telefone inválido vira null", () => {
    const r = normalizarVendaPay(pedido({ Customer: { email: "a@b.com", mobile: "123" } }), AGORA);
    expect(r.resultado === "aceita" && r.venda.telefone).toBeNull();
  });

  it("telefone sem código do país é lido como Brasil (padrão do paraE164)", () => {
    const r = normalizarVendaPay(pedido({ Customer: { email: "a@b.com", mobile: "1138887777" } }), AGORA);
    expect(r.resultado === "aceita" && r.venda.telefone).toBe("+551138887777");
  });

  it("order_status diferente de paid: ignorada", () => {
    expect(normalizarVendaPay(pedido({ order_status: "waiting_payment" }), AGORA)).toEqual({
      resultado: "ignorada",
      motivo: "Evento não é compra aprovada nem reembolsada.",
    });
  });
});

describe("normalizarVendaPay: reembolso", () => {
  it("aceita como reembolsada", () => {
    const r = normalizarVendaPay(pedido({ webhook_event_type: "compra_reembolsada", order_status: "refunded" }), AGORA);
    expect(r.resultado === "aceita" && r.venda.status).toBe("reembolsada");
  });

  it("evento de reembolso com status diferente de refunded: ignorada", () => {
    expect(normalizarVendaPay(pedido({ webhook_event_type: "compra_reembolsada", order_status: "paid" }), AGORA)).toEqual({
      resultado: "ignorada",
      motivo: "Evento não é compra aprovada nem reembolsada.",
    });
  });
});

describe("normalizarVendaPay: outros eventos e corpo inválido", () => {
  it("outros eventos (Pix gerado, recusada, chargeback): ignorada", () => {
    for (const ev of ["pix_gerado", "compra_recusada", "compra_chargeback"]) {
      expect(normalizarVendaPay(pedido({ webhook_event_type: ev, order_status: "waiting_payment" }), AGORA)).toEqual({
        resultado: "ignorada",
        motivo: "Evento não é compra aprovada nem reembolsada.",
      });
    }
  });

  it("corpo que não é JSON: ignorada", () => {
    expect(normalizarVendaPay("não é json", AGORA)).toEqual({ resultado: "ignorada", motivo: "Corpo inválido." });
  });

  it("corpo JSON que não é objeto: ignorada", () => {
    expect(normalizarVendaPay("123", AGORA)).toEqual({ resultado: "ignorada", motivo: "Corpo inválido." });
  });

  it("sem id da transação: ignorada com motivo (nunca 'undefined')", () => {
    expect(normalizarVendaPay(pedido({ order_id: undefined }), AGORA)).toEqual({ resultado: "ignorada", motivo: "Venda sem id da transação." });
    expect(normalizarVendaPay(pedido({ order_id: "  " }), AGORA)).toEqual({ resultado: "ignorada", motivo: "Venda sem id da transação." });
  });

  it("id numérico vira texto", () => {
    const r = normalizarVendaPay(pedido({ order_id: 123 }), AGORA);
    expect(r.resultado === "aceita" && r.venda.orderId).toBe("123");
  });

  it("valor ausente, não numérico ou negativo: ignorada com motivo", () => {
    expect(normalizarVendaPay(pedido({ Commissions: {} }), AGORA)).toEqual({ resultado: "ignorada", motivo: "Valor inválido." });
    expect(normalizarVendaPay(pedido({ Commissions: { charge_amount: "abc" } }), AGORA)).toEqual({ resultado: "ignorada", motivo: "Valor inválido." });
    expect(normalizarVendaPay(pedido({ Commissions: { charge_amount: -1 } }), AGORA)).toEqual({ resultado: "ignorada", motivo: "Valor inválido." });
  });

  it("valor numérico em texto é lido; zero vale", () => {
    const r1 = normalizarVendaPay(pedido({ Commissions: { charge_amount: "9700" } }), AGORA);
    expect(r1.resultado === "aceita" && r1.venda.valorCentavos).toBe(9700);
    const r2 = normalizarVendaPay(pedido({ Commissions: { charge_amount: 0 } }), AGORA);
    expect(r2.resultado === "aceita" && r2.venda.valorCentavos).toBe(0);
  });

  it("e-mail vira minúsculo; sem e-mail vira null", () => {
    const r1 = normalizarVendaPay(pedido({ Customer: { email: "Ana@X.COM", mobile: "+551138887777" } }), AGORA);
    expect(r1.resultado === "aceita" && r1.venda.email).toBe("ana@x.com");
    const r2 = normalizarVendaPay(pedido({ Customer: { mobile: "+551138887777" } }), AGORA);
    expect(r2.resultado === "aceita" && r2.venda.email).toBeNull();
  });
});
