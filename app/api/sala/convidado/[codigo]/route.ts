import { NextResponse } from "next/server";
import { hashIp } from "@/src/lib/crypto";
import { dentroDoLimite } from "@/src/lib/limite";
import { ErroRtk } from "@/src/lib/realtimekit";
import { passeConvidado, RegistroNaoEncontrado } from "@/src/lib/sala";

export const dynamic = "force-dynamic";

/** Entrada do convidado na sala: só devolve token quando a sala está aberta. */
export async function POST(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "sem-ip";
  if (!(await dentroDoLimite(`sala-convidado:${hashIp(ip)}`, 20))) {
    return NextResponse.json({ erro: "Muitas tentativas. Espere um minuto." }, { status: 429 });
  }
  try {
    const r = await passeConvidado(codigo);
    if (!r.passe) return NextResponse.json({ estado: r.estado }, { status: 409 });
    return NextResponse.json(r.passe);
  } catch (e) {
    if (e instanceof RegistroNaoEncontrado) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });
    if (e instanceof ErroRtk) return NextResponse.json({ erro: "Não conseguimos abrir a sala. Tente de novo." }, { status: 502 });
    throw e;
  }
}
