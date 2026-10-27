/** Normalização das vendas que chegam por webhook no formato da Kiwify (plataforma de pagamento):
 *  `webhook_event_type`, `order_id`, `order_status`, `Commissions.charge_amount` (centavos), `Customer.email`/
 *  `mobile`, `Product.product_name`, `created_at`. Função pura: quem recebe o HTTP, confere o token da URL e
 *  grava no banco é `app/api/webhooks/pay/[token]/route.ts` + `src/lib/vendas.ts`.
 *
 *  Compra aprovada: `webhook_event_type === "compra_aprovada"` com `order_status === "paid"`.
 *  Reembolso: `webhook_event_type === "compra_reembolsada"` com `order_status === "refunded"`.
 *  Qualquer outro evento (Pix gerado, recusada, chargeback…) é ignorado. */

import { paraE164 } from "./telefone";

export type StatusVendaPay = "aprovada" | "reembolsada";

export type VendaPay = {
  orderId: string;
  status: StatusVendaPay;
  valorCentavos: number;
  produto: string | null;
  email: string | null;
  telefone: string | null;
  compradaEm: string;
};

export type ResultadoVendaPay = { resultado: "aceita"; venda: VendaPay } | { resultado: "ignorada"; motivo: string };

function texto(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** Id da transação: texto não vazio ou número; qualquer outra coisa (inclusive ausente) é `null` — nunca vira
 *  "undefined" por `String(undefined)`. */
function idDaTransacao(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Valor numérico (número ou texto só com dígitos e ponto decimal); `null` se não der pra ler. */
function valorNumerico(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

/** Data e hora sem fuso ("YYYY-MM-DD HH:mm", com ou sem segundos/fração, espaço ou T), como a Kiwify manda. */
const SEM_FUSO = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/;

/** Data da compra: `created_at` em ISO; sem data válida, usa agora. Sem fuso (formato da Kiwify) é horário de
 *  Brasília (UTC-3 fixo, o Brasil não tem horário de verão desde 2019) — `new Date()` leria no fuso do servidor. */
function dataOuAgora(v: unknown, agora: () => Date): string {
  if (typeof v === "string") {
    const m = SEM_FUSO.exec(v.trim());
    const d = new Date(m ? `${m[1]}T${m[2]}${m[3] ?? ":00"}-03:00` : v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return agora().toISOString();
}

function corpoJsonOuNulo(corpo: string): Record<string, unknown> | null {
  try {
    const d = JSON.parse(corpo);
    return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Normaliza o corpo bruto do webhook da Pay numa venda (ou diz por que foi ignorado). `agora` é injetável pra
 *  teste determinístico quando o payload não traz `created_at`. */
export function normalizarVendaPay(corpoBruto: string, agora: () => Date = () => new Date()): ResultadoVendaPay {
  const d = corpoJsonOuNulo(corpoBruto);
  if (!d) return { resultado: "ignorada", motivo: "Corpo inválido." };

  const status: StatusVendaPay | null =
    d.webhook_event_type === "compra_aprovada" && d.order_status === "paid"
      ? "aprovada"
      : d.webhook_event_type === "compra_reembolsada" && d.order_status === "refunded"
        ? "reembolsada"
        : null;
  if (!status) return { resultado: "ignorada", motivo: "Evento não é compra aprovada nem reembolsada." };

  const orderId = idDaTransacao(d.order_id);
  if (!orderId) return { resultado: "ignorada", motivo: "Venda sem id da transação." };

  const commissions = (d.Commissions as Record<string, unknown>) ?? {};
  const valor = valorNumerico(commissions.charge_amount);
  if (valor === null || valor < 0) return { resultado: "ignorada", motivo: "Valor inválido." };

  const customer = (d.Customer as Record<string, unknown>) ?? {};
  const produto = (d.Product as Record<string, unknown>) ?? {};
  const email = texto(customer.email)?.trim().toLowerCase() || null;
  const telefoneBruto = texto(customer.mobile);

  return {
    resultado: "aceita",
    venda: {
      orderId,
      status,
      valorCentavos: Math.round(valor),
      produto: texto(produto.product_name),
      email,
      telefone: telefoneBruto ? paraE164(telefoneBruto) : null,
      compradaEm: dataOuAgora(d.created_at, agora),
    },
  };
}
