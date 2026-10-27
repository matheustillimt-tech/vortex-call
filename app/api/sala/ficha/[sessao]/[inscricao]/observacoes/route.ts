import { NextResponse } from "next/server";
import { podeVerSessao } from "@/src/lib/acesso";
import { salvarObservacoes } from "@/src/lib/ficha";
import { MAX_OBSERVACOES } from "@/src/lib/regras/ficha";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Salva as observações da equipe sobre a pessoa (valem em todas as sessões dela). */
export async function PUT(req: Request, { params }: { params: Promise<{ sessao: string; inscricao: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(membro, "ficha")) return NextResponse.json({ erro: SEM_PERMISSAO }, { status: 403 });
  const { sessao, inscricao } = await params;
  if (!UUID.test(sessao) || !UUID.test(inscricao)) return NextResponse.json({ erro: "Pessoa não encontrada nesta sessão." }, { status: 404 });
  // Recorte por agenda (a RLS do cliente da pessoa também recorta; aqui a resposta é a mesma 404, sem ler nada).
  if (!(await podeVerSessao(membro, sessao))) return NextResponse.json({ erro: "Pessoa não encontrada nesta sessão." }, { status: 404 });
  const corpo = (await req.json().catch(() => null)) as { texto?: unknown } | null;
  if (typeof corpo?.texto !== "string" || corpo.texto.length > MAX_OBSERVACOES) {
    return NextResponse.json({ erro: "Observação inválida (até 10.000 caracteres)." }, { status: 400 });
  }
  const r = await salvarObservacoes(dbAdmin(), sessao, inscricao, corpo.texto, !pode(membro, "contato_lead"));
  if (r === "travada") {
    return NextResponse.json({ erro: "Essas observações têm contato do lead: só quem vê o contato pode editar." }, { status: 409 });
  }
  if (r === "nao_encontrada") return NextResponse.json({ erro: "Pessoa não encontrada nesta sessão." }, { status: 404 });
  if (r === "erro") return NextResponse.json({ erro: "Não deu pra salvar. Tente de novo." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
