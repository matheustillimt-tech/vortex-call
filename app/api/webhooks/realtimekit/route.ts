import { NextResponse } from "next/server";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { obterChavePublica, processarEvento, renovarChaveSeVelha, verificarAssinatura } from "@/src/lib/regras/webhook-rtk";

export const dynamic = "force-dynamic";

/** Webhook do RealtimeKit: `recording.statusUpdate` (gravações), `meeting.ended` (fim de call) e
 *  `meeting.participantJoined`/`meeting.participantLeft` (presença na sala, base do compareceu/faltou do Vórtex
 *  CRM); outros eventos só ficam registrados em `webhook_recebidos`. 200 sempre que a
 *  assinatura é válida, mesmo quando o evento é ignorado ou repetido — só assinatura ausente/inválida vira 401.
 *  Se o processamento falhar, desfaz o registro de dedupe e devolve 500 pra Cloudflare reenviar. */
export async function POST(req: Request): Promise<Response> {
  const assinatura = req.headers.get("rtk-signature");
  const uuid = req.headers.get("rtk-uuid");
  if (!assinatura || !uuid) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });

  const corpo = await req.arrayBuffer();

  let chave: string;
  try {
    chave = await obterChavePublica();
  } catch (e) {
    console.error("[webhook rtk] falha ao obter a chave pública", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Não foi possível verificar a assinatura." }, { status: 500 });
  }
  let valido = await verificarAssinatura(chave, assinatura, corpo);
  if (!valido) {
    // A Cloudflare pode ter trocado a chave: com cache de mais de 5 min, busca uma vez e verifica de novo.
    const nova = await renovarChaveSeVelha().catch(() => null);
    if (nova && nova !== chave) valido = await verificarAssinatura(nova, assinatura, corpo);
  }
  if (!valido) return NextResponse.json({ erro: "Assinatura inválida." }, { status: 401 });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(corpo).toString("utf-8")) as Record<string, unknown>;
  } catch (e) {
    console.error("[webhook rtk] corpo inválido (JSON.parse falhou)", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "corpo inválido" }, { status: 400 });
  }
  const evento = typeof payload.event === "string" ? payload.event : "desconhecido";

  const db = dbAdmin();
  const { error: erroInsercao } = await db.from("webhook_recebidos").insert({ uuid, evento });
  if (erroInsercao) {
    if ((erroInsercao as { code?: string }).code === "23505") return NextResponse.json({ repetido: true });
    return NextResponse.json({ erro: "Não foi possível registrar o webhook." }, { status: 500 });
  }

  try {
    await processarEvento(db, evento, payload);
  } catch (e) {
    console.error("[webhook rtk] falha ao processar evento", evento, e instanceof Error ? e.message : e);
    await db.from("webhook_recebidos").delete().eq("uuid", uuid);
    return NextResponse.json({ erro: "Não foi possível processar o evento." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
