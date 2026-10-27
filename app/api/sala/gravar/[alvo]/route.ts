import { NextResponse } from "next/server";
import { podeVerSessao } from "@/src/lib/acesso";
import { comecarGravacao, pararGravacao, type AlvoGravacao } from "@/src/lib/gravacao";
import { ErroRtk } from "@/src/lib/realtimekit";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { situacaoReuniao } from "@/src/lib/regras/reuniao";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Meeting do alvo e se ele ainda está aberto (sessão `ao_vivo`; reunião não encerrada nem vencida). */
async function meetingDoAlvo(tipo: AlvoGravacao, id: string): Promise<{ meetingId: string | null; aberta: boolean } | null> {
  const db = dbAdmin();
  if (tipo === "sessao") {
    const { data } = await db.from("sessoes").select("status, rtk_meeting_id").eq("id", id).maybeSingle();
    if (!data) return null;
    return { meetingId: (data.rtk_meeting_id as string | null) ?? null, aberta: data.status === "ao_vivo" };
  }
  const { data } = await db.from("reunioes").select("encerrada_em, expira_em, rtk_meeting_id").eq("id", id).maybeSingle();
  if (!data) return null;
  const r = data as { encerrada_em: string | null; expira_em: string; rtk_meeting_id: string | null };
  return { meetingId: r.rtk_meeting_id ?? null, aberta: situacaoReuniao(r) === "ativa" };
}

/** Botão Gravar / Parar gravação do anfitrião. Admin liga ou desliga a gravação de qualquer sessão ou reunião pelo
 *  id, mesmo sem estar na sala; membro, só das sessões das agendas dele (e de qualquer reunião, como antes). Corpo `{tipo: "sessao"|"reuniao", ligar}`.
 *  Ligar começa a gravar pela API (com R2 configurado o arquivo vai pro bucket da empresa); desligar para a gravação
 *  ativa (nada gravando também é `ok`). Sem meeting ainda, ou ligar com a call fechada → 409. Permissões: gravar
 *  sessão é coisa de anfitrião (`anfitriao`); gravar reunião precisa de `reunioes` (sem elas, 403). */
export async function POST(req: Request, { params }: { params: Promise<{ alvo: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const { alvo } = await params;
  const corpo = (await req.json().catch(() => null)) as { tipo?: unknown; ligar?: unknown } | null;
  const tipo = corpo?.tipo;
  if ((tipo !== "sessao" && tipo !== "reuniao") || typeof corpo?.ligar !== "boolean") {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }
  if (!pode(membro, tipo === "sessao" ? "anfitriao" : "reunioes")) return NextResponse.json({ erro: SEM_PERMISSAO }, { status: 403 });
  if (!UUID.test(alvo)) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });
  if (tipo === "sessao" && !(await podeVerSessao(membro, alvo))) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });
  const ligar = corpo.ligar;

  const alvoDb = await meetingDoAlvo(tipo, alvo);
  if (!alvoDb) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });
  if (!alvoDb.meetingId) return NextResponse.json({ erro: "A sala ainda não foi aberta." }, { status: 409 });
  if (ligar && !alvoDb.aberta) return NextResponse.json({ erro: "Essa call já terminou." }, { status: 409 });

  try {
    if (ligar) await comecarGravacao({ tipo, id: alvo }, alvoDb.meetingId);
    else await pararGravacao(alvoDb.meetingId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ErroRtk) {
      console.error("[sala/gravar]", ligar ? "iniciar" : "parar", e.status);
      return NextResponse.json({ erro: ligar ? "Não deu para começar a gravar." : "Não deu para parar a gravação." }, { status: 502 });
    }
    throw e;
  }
}
