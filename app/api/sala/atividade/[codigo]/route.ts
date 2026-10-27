import { NextResponse } from "next/server";
import { dentroDoLimite } from "@/src/lib/limite";
import { ehCodigoValido } from "@/src/lib/regras/codigo";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Limite de envios por código, por minuto (a sala manda a cada 30 s). */
const LIMITE_POR_MINUTO = 6;

/** Inteiro ≥ 0; o que não for número vira 0. O teto de verdade (35 s / 35 s / 20) fica na função SQL; aqui só evita
 *  estourar o `int` do banco. */
function inteiro(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.min(1_000_000, Math.max(0, Math.floor(v)));
}

const semConteudo = () => new NextResponse(null, { status: 204 });

/** Atividade do convidado na sala (segundos de microfone e câmera e mensagens desde o último envio). Público pelo
 *  código. Responde 204 mesmo quando nada é somado (sessão fora do ar, inscrição cancelada), pra não contar estado. */
export async function POST(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  if (!ehCodigoValido(codigo)) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });
  if (!(await dentroDoLimite(`sala-atividade:${codigo}`, LIMITE_POR_MINUTO))) {
    return NextResponse.json({ erro: "Muitas tentativas. Espere um minuto." }, { status: 429 });
  }
  const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const mic = inteiro(corpo?.mic);
  const cam = inteiro(corpo?.cam);
  const msgs = inteiro(corpo?.msgs);

  const db = dbAdmin();
  const { data: inscricao } = await db.from("inscricoes").select("id, sessao_id").eq("codigo", codigo).maybeSingle();
  if (!inscricao) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });
  if (mic === 0 && cam === 0 && msgs === 0) return semConteudo();

  const { error } = await db.rpc("somar_atividade", {
    p_inscricao: inscricao.id,
    p_sessao: inscricao.sessao_id,
    p_mic: mic,
    p_cam: cam,
    p_msgs: msgs,
  });
  if (error) console.error("[atividade] não somou", inscricao.id, error.message);
  return semConteudo();
}
