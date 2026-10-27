import { NextResponse } from "next/server";
import { podeVerSessao } from "@/src/lib/acesso";
import { alinhamentoAoVivo } from "@/src/lib/alinhamento";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { sessaoAceitaTrechos } from "@/src/lib/transcricao";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";
// A IA pode levar até ~45 s com a transcrição de uma call longa.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Alinhado até agora" da aba da sala (anfitrião e espião pedem a cada 2 min). Permissão `transcricao` + acesso à
 *  sessão; sessão que não transcreve = 409. Quem decide se chama a IA de novo é `alinhamentoAoVivo`. */
export async function POST(_req: Request, { params }: { params: Promise<{ sessao: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const { sessao } = await params;
  if (!UUID.test(sessao)) return NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });
  if (!pode(membro, "transcricao")) return NextResponse.json({ erro: SEM_PERMISSAO }, { status: 403 });
  if (!(await podeVerSessao(membro, sessao))) return NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });
  if (!(await sessaoAceitaTrechos(sessao))) return NextResponse.json({ erro: "Essa sessão não está sendo transcrita." }, { status: 409 });
  return NextResponse.json(await alinhamentoAoVivo(sessao));
}
