import { NextResponse } from "next/server";
import { podeVerSessao } from "@/src/lib/acesso";
import { lerFicha } from "@/src/lib/ficha";
import { mascararContatoFicha } from "@/src/lib/regras/contato";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ficha de uma pessoa da sessão, para a coluna da sala. Só equipe (o convidado não tem login) com a permissão
 *  `ficha`, na sessão de agenda dela. Lê pela service role (o cliente da equipe não lê o contato do lead) e, sem
 *  `contato_lead`, mascara WhatsApp/e-mail antes de responder. */
export async function GET(_req: Request, { params }: { params: Promise<{ sessao: string; inscricao: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(membro, "ficha")) return NextResponse.json({ erro: SEM_PERMISSAO }, { status: 403 });
  const { sessao, inscricao } = await params;
  if (!UUID.test(sessao) || !UUID.test(inscricao)) return NextResponse.json({ erro: "Pessoa não encontrada nesta sessão." }, { status: 404 });
  // Recorte por agenda (a RLS do cliente da pessoa também recorta; aqui a resposta é a mesma 404, sem ler nada).
  if (!(await podeVerSessao(membro, sessao))) return NextResponse.json({ erro: "Pessoa não encontrada nesta sessão." }, { status: 404 });
  const ficha = await lerFicha(dbAdmin(), sessao, inscricao, membro.papel === "admin" ? undefined : membro.id);
  if (!ficha) return NextResponse.json({ erro: "Pessoa não encontrada nesta sessão." }, { status: 404 });
  const resposta = pode(membro, "contato_lead") ? ficha : mascararContatoFicha(ficha);
  return NextResponse.json(resposta, { headers: { "Cache-Control": "no-store" } });
}
