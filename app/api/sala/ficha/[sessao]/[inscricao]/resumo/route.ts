import { NextResponse } from "next/server";
import { podeVerSessao } from "@/src/lib/acesso";
import { iaConfig } from "@/src/lib/env";
import { gerarResumo } from "@/src/lib/ficha";
import { mascararContatosNoTexto } from "@/src/lib/regras/contato";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gera (na primeira vez) e devolve o resumo por IA da pessoa. */
export async function POST(_req: Request, { params }: { params: Promise<{ sessao: string; inscricao: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(membro, "ficha")) return NextResponse.json({ erro: SEM_PERMISSAO }, { status: 403 });
  const { sessao, inscricao } = await params;
  if (!UUID.test(sessao) || !UUID.test(inscricao)) return NextResponse.json({ erro: "Pessoa não encontrada nesta sessão." }, { status: 404 });
  // Recorte por agenda (a RLS do cliente da pessoa também recorta; aqui a resposta é a mesma 404, sem ler nada).
  if (!(await podeVerSessao(membro, sessao))) return NextResponse.json({ erro: "Pessoa não encontrada nesta sessão." }, { status: 404 });
  const ia = iaConfig();
  if (!ia) return NextResponse.json({ erro: "Resumo por IA desligado." }, { status: 503 });
  const r = await gerarResumo(dbAdmin(), sessao, inscricao, ia);
  if (!r) return NextResponse.json({ erro: "Pessoa não encontrada nesta sessão." }, { status: 404 });
  if (r.estado === "falhou") return NextResponse.json({ erro: "Não deu pra gerar o resumo agora." }, { status: 502 });
  // Sem `contato_lead`: telefone/e-mail no meio do resumo saem mascarados.
  if (r.estado === "pronto" && !pode(membro, "contato_lead")) return NextResponse.json({ ...r, texto: mascararContatosNoTexto(r.texto) });
  return NextResponse.json(r);
}
