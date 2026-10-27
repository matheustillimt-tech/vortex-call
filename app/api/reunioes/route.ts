import { NextResponse } from "next/server";
import { siteUrl } from "@/src/lib/env";
import { ErroRtk } from "@/src/lib/realtimekit";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { criarReuniao } from "@/src/lib/reunioes";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

/** Cria uma reunião instantânea (membro ativo com a permissão `reunioes`; sem ela, 403 — entrar pelo link de uma
 *  reunião que já existe continua liberado). Corpo opcional `{ titulo }`; devolve o código e o link. */
export async function POST(req: Request) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(membro, "reunioes")) return NextResponse.json({ erro: SEM_PERMISSAO }, { status: 403 });
  const corpo = (await req.json().catch(() => null)) as { titulo?: unknown } | null;
  const titulo = typeof corpo?.titulo === "string" ? corpo.titulo : undefined;
  try {
    const { codigo } = await criarReuniao(membro, titulo);
    return NextResponse.json({ codigo, link: `${siteUrl()}/r/${codigo}` });
  } catch (e) {
    if (e instanceof ErroRtk) return NextResponse.json({ erro: "Não conseguimos criar a sala. Tente de novo." }, { status: 502 });
    throw e;
  }
}
