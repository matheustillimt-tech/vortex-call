import { NextResponse } from "next/server";
import { podeVerSessao } from "@/src/lib/acesso";
import { codigoDoConvite } from "@/src/lib/convite";
import { siteUrl } from "@/src/lib/env";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { RegistroNaoEncontrado, SessaoIndisponivel } from "@/src/lib/sala";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Link de convidado da sessão (`/s/{codigo}`), pro botão da barra do anfitrião. Mesma regra de quem conduz a sala
 *  (`POST /api/sala/equipe/{sessao}` como anfitrião): admin em qualquer sessão; membro só nas agendas em que é o
 *  responsável e com a permissão `anfitriao` (só espião = 403). Sessão de outra agenda = 404. */
export async function POST(_req: Request, { params }: { params: Promise<{ sessao: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const { sessao } = await params;
  if (!UUID.test(sessao)) return NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });
  if (!pode(membro, "anfitriao")) return NextResponse.json({ erro: SEM_PERMISSAO }, { status: 403 });
  if (!(await podeVerSessao(membro, sessao))) return NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });
  try {
    const codigo = await codigoDoConvite(sessao, membro.id);
    return NextResponse.json({ link: `${siteUrl()}/s/${codigo}` });
  } catch (e) {
    if (e instanceof RegistroNaoEncontrado) return NextResponse.json({ erro: "Sessão não encontrada." }, { status: 404 });
    if (e instanceof SessaoIndisponivel) return NextResponse.json({ erro: "Essa call já terminou.", estado: e.status }, { status: 409 });
    throw e;
  }
}
