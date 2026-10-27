import { NextResponse } from "next/server";
import { ErroRtk } from "@/src/lib/realtimekit";
import { encerrarReuniao, ReuniaoEncerrada } from "@/src/lib/reunioes";
import { RegistroNaoEncontrado } from "@/src/lib/sala";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

/** Encerra a reunião pra todo mundo: qualquer membro ativo pode. */
export async function POST(_req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const { codigo } = await params;
  try {
    await encerrarReuniao(codigo, membro);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RegistroNaoEncontrado) return NextResponse.json({ erro: "Reunião não encontrada." }, { status: 404 });
    if (e instanceof ReuniaoEncerrada) return NextResponse.json({ erro: "Essa reunião já terminou." }, { status: 409 });
    if (e instanceof ErroRtk) return NextResponse.json({ erro: "Não conseguimos encerrar a sala. Tente de novo." }, { status: 502 });
    throw e;
  }
}
