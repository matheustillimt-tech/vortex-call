import { NextResponse } from "next/server";
import { segredosIguais } from "@/src/lib/crypto";
import { envOpcional } from "@/src/lib/env";
import { normalizarVendaPay } from "@/src/lib/regras/venda-pay";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { avisarCompra, registrarVenda } from "@/src/lib/vendas";

export const dynamic = "force-dynamic";

/** Corpo máximo aceito (256 KB); acima disso nem tenta ler como JSON. */
const TAMANHO_MAXIMO = 256 * 1024;

const ignorado = () => NextResponse.json({ ignorado: true });

/** Webhook de vendas (plataforma de pagamento no formato da Kiwify). Token no caminho da URL (não no corpo nem em header): sem `PAY_WEBHOOK_TOKEN`
 *  configurado ou com o token errado, devolve 404 (nunca revela se a rota existe). Evento que não é compra
 *  aprovada ou reembolsada, corpo inválido ou grande demais: 200 `{ ignorado: true }` — sempre 200 pra plataforma
 *  não ficar reenviando um webhook que ela, de propósito ou não, manda fora do que o Vórtex Call entende. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const segredo = envOpcional("PAY_WEBHOOK_TOKEN");
  if (!segredo || !segredosIguais(token, segredo)) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });

  const corpo = await req.text();
  if (Buffer.byteLength(corpo, "utf-8") > TAMANHO_MAXIMO) return ignorado();

  const resultado = normalizarVendaPay(corpo);
  if (resultado.resultado === "ignorada") return ignorado();

  try {
    await registrarVenda(dbAdmin(), resultado.venda);
  } catch (e) {
    console.error("[webhook pay] não registrou a venda", resultado.venda.orderId, e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Não foi possível registrar a venda." }, { status: 500 });
  }
  if (resultado.venda.status === "aprovada") await avisarCompra(dbAdmin(), { orderId: resultado.venda.orderId });
  return NextResponse.json({ ok: true });
}
