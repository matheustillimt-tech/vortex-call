import { NextResponse } from "next/server";
import { podeVerSessao } from "@/src/lib/acesso";
import { ErroRtk } from "@/src/lib/realtimekit";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { passeEquipe, RegistroNaoEncontrado, SessaoIndisponivel, statusDaSessao } from "@/src/lib/sala";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";
// O `after()` da gravação automática (`gravarAoAbrir`) espera até ~50 s pelo anfitrião entrar.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Status da sessão pra tela da equipe decidir o que mostrar depois de ser tirada da sala. */
export async function GET(_req: Request, { params }: { params: Promise<{ sessao: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const { sessao } = await params;
  if (!UUID.test(sessao)) return NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });
  if (!(await podeVerSessao(membro, sessao))) return NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });
  const status = await statusDaSessao(sessao);
  if (!status) return NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });
  return NextResponse.json({ status });
}

/** Entrada da equipe (anfitrião ou espião): admin em qualquer sessão; membro só nas sessões das agendas em que é o
 *  responsável (vendedor) e com a permissão do modo (`anfitriao`/`espiao`; sem ela, 403). Sessão de outra agenda =
 *  404, igual a inexistente (`todas_agendas` é só leitura no painel: não abre a sala). */
export async function POST(req: Request, { params }: { params: Promise<{ sessao: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const { sessao } = await params;
  const corpo = (await req.json().catch(() => null)) as { modo?: string } | null;
  if (corpo?.modo !== "anfitriao" && corpo?.modo !== "espiao") {
    return NextResponse.json({ erro: "Modo inválido." }, { status: 400 });
  }
  if (!pode(membro, corpo.modo)) return NextResponse.json({ erro: SEM_PERMISSAO }, { status: 403 });
  if (!(await podeVerSessao(membro, sessao))) return NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });
  try {
    const passe = await passeEquipe(sessao, { id: membro.id, nome: membro.nome }, corpo.modo);
    return NextResponse.json(passe);
  } catch (e) {
    if (e instanceof RegistroNaoEncontrado) return NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });
    if (e instanceof SessaoIndisponivel) return NextResponse.json({ erro: "Sessão não está disponível.", estado: e.status }, { status: 409 });
    if (e instanceof ErroRtk) return NextResponse.json({ erro: "Não conseguimos abrir a sala. Tente de novo." }, { status: 502 });
    throw e;
  }
}
