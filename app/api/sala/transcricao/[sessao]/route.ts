import { NextResponse } from "next/server";
import { podeVerSessao } from "@/src/lib/acesso";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { lerLote } from "@/src/lib/regras/transcricao";
import { listarTrechos, salvarTrechos, sessaoAceitaTrechos } from "@/src/lib/transcricao";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const naoEncontrada = () => NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });

/** Falas da transcrição da sessão, pra aba "Alinhado" (anfitrião e espião). Permissão `transcricao` + acesso à
 *  sessão. `?desde=` (ISO, de `agora` da resposta anterior) traz só as gravadas depois. */
export async function GET(req: Request, { params }: { params: Promise<{ sessao: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const { sessao } = await params;
  if (!UUID.test(sessao)) return naoEncontrada();
  if (!pode(membro, "transcricao")) return NextResponse.json({ erro: SEM_PERMISSAO }, { status: 403 });
  if (!(await podeVerSessao(membro, sessao))) return naoEncontrada();
  const desdeBruto = new URL(req.url).searchParams.get("desde");
  const desde = desdeBruto && Number.isFinite(Date.parse(desdeBruto)) ? new Date(desdeBruto).toISOString() : undefined;
  const agora = new Date().toISOString();
  const trechos = await listarTrechos(sessao, desde);
  return NextResponse.json({ trechos, agora });
}

/** Lote de falas finais da sala do anfitrião (a cada 15 s). Mesma regra de quem conduz a sala: admin, ou o
 *  responsável pela agenda com a permissão `anfitriao`. Sessão sem transcrição ou fora do ar = 409 (a sala para de
 *  mandar). */
export async function POST(req: Request, { params }: { params: Promise<{ sessao: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const { sessao } = await params;
  if (!UUID.test(sessao)) return naoEncontrada();
  if (!pode(membro, "anfitriao")) return NextResponse.json({ erro: SEM_PERMISSAO }, { status: 403 });
  if (!(await podeVerSessao(membro, sessao))) return naoEncontrada();
  const { trechos, erro } = lerLote(await req.json().catch(() => null));
  if (!trechos) return NextResponse.json({ erro }, { status: 400 });
  if (!(await sessaoAceitaTrechos(sessao))) return NextResponse.json({ erro: "Essa sessão não está sendo transcrita." }, { status: 409 });
  await salvarTrechos(sessao, trechos);
  return NextResponse.json({ gravados: trechos.length });
}
