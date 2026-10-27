import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enfileirar } from "./eventos";
import type { VendaPay } from "./regras/venda-pay";

/** Registra a venda do webhook de pagamento (upsert por `order_id`, liga à inscrição que assistiu: ver `registrar_venda`
 *  na migração `20261023180000_vendas_pay.sql`). `payload` guarda só os campos normalizados (nunca o corpo bruto
 *  do webhook, que pode trazer cartão/documento) — já é o mínimo que a tabela `vendas` pede. */
export async function registrarVenda(db: SupabaseClient, venda: VendaPay): Promise<void> {
  const payload = {
    orderId: venda.orderId,
    status: venda.status,
    valorCentavos: venda.valorCentavos,
    produto: venda.produto,
    email: venda.email,
    telefone: venda.telefone,
    compradaEm: venda.compradaEm,
  };
  const { error } = await db.rpc("registrar_venda", {
    p_order_id: venda.orderId,
    p_status: venda.status,
    p_valor_centavos: venda.valorCentavos,
    p_produto: venda.produto,
    p_email: venda.email,
    p_whatsapp: venda.telefone,
    p_comprada_em: venda.compradaEm,
    p_payload: payload,
  });
  if (error) throw new Error("Não foi possível registrar a venda.");
}

type VendaLigada = { order_id: string; produto: string | null; valor_centavos: number; comprada_em: string; inscricao_id: string };

/** Evento `comprou` pro CRM (move o negócio pra "Comprou" com o valor) de cada venda aprovada já ligada a uma
 *  inscrição: pela venda que acabou de chegar (`orderId`, webhook da Pay) ou pelas que a avaliação de presença acabou
 *  de religar (`inscricaoId`). Um por inscrição e sessão (`id_evento`), então a segunda compra da mesma pessoa não
 *  repete o aviso. Nunca lança: a venda já está gravada e o aviso é só um extra. */
export async function avisarCompra(db: SupabaseClient, filtro: { orderId: string } | { inscricaoId: string }): Promise<void> {
  let consulta = db.from("vendas").select("order_id, produto, valor_centavos, comprada_em, inscricao_id")
    .eq("status", "aprovada").not("inscricao_id", "is", null);
  consulta = "orderId" in filtro ? consulta.eq("order_id", filtro.orderId) : consulta.eq("inscricao_id", filtro.inscricaoId);
  const { data, error } = await consulta;
  if (error) {
    console.error("[crm] não leu as vendas pro aviso de compra", error.message);
    return;
  }
  for (const v of (data ?? []) as VendaLigada[]) {
    try {
      await enfileirar("comprou", v.inscricao_id, new Date(), {
        venda: { pedido: v.order_id, produto: v.produto, valorCentavos: v.valor_centavos, compradaEm: v.comprada_em },
      });
    } catch (e) {
      console.error("[crm] não enfileirou o comprou", v.order_id, e instanceof Error ? e.message : e);
    }
  }
}
