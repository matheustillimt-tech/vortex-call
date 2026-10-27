import { NextResponse } from "next/server";
import { podeVerSessao } from "@/src/lib/acesso";
import { ErroRtk } from "@/src/lib/realtimekit";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { encerrarSessao, RegistroNaoEncontrado, SessaoIndisponivel } from "@/src/lib/sala";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Encerra a sessão (`agendada` ou `ao_vivo`): admin em qualquer uma; membro só nas das agendas dele e com a
 *  permissão `anfitriao` (quem só entra como espião não encerra a call; sem ela, 403). */
export async function POST(req: Request, { params }: { params: Promise<{ sessao: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(membro, "anfitriao")) return NextResponse.json({ erro: SEM_PERMISSAO }, { status: 403 });
  const { sessao } = await params;
  if (!UUID.test(sessao)) return NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });
  if (!(await podeVerSessao(membro, sessao))) return NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });
  try {
    await encerrarSessao(sessao);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RegistroNaoEncontrado) return NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });
    if (e instanceof SessaoIndisponivel) return NextResponse.json({ erro: "Esta sessão já foi encerrada.", estado: e.status }, { status: 409 });
    if (e instanceof ErroRtk) return NextResponse.json({ erro: "Não conseguimos encerrar a sala. Tente de novo." }, { status: 502 });
    throw e;
  }
}
