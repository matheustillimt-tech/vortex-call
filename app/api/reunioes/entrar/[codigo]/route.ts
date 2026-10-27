import { NextResponse } from "next/server";
import { hashIp } from "@/src/lib/crypto";
import { dentroDoLimite } from "@/src/lib/limite";
import { ErroRtk } from "@/src/lib/realtimekit";
import { ehVisitanteId, limparNomeVisitante } from "@/src/lib/regras/reuniao";
import { passeReuniaoMembro, passeReuniaoVisitante, ReuniaoEncerrada } from "@/src/lib/reunioes";
import { RegistroNaoEncontrado } from "@/src/lib/sala";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

/** Pública. Membro logado entra como anfitrião (o corpo é ignorado); pessoa de fora manda `{ nome, visitanteId }`
 *  e entra como participante, com limite de 20 passes por minuto por IP. */
export async function POST(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  try {
    const membro = await membroApi();
    if (membro) return NextResponse.json(await passeReuniaoMembro(codigo, { id: membro.id, nome: membro.nome }));

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "sem-ip";
    if (!(await dentroDoLimite(`reuniao-visitante:${hashIp(ip)}`, 20))) {
      return NextResponse.json({ erro: "Muitas tentativas. Espere um minuto." }, { status: 429 });
    }
    const corpo = (await req.json().catch(() => null)) as { nome?: unknown; visitanteId?: unknown } | null;
    const nome = limparNomeVisitante(corpo?.nome);
    if (!nome) return NextResponse.json({ erro: "Digite seu nome (de 2 a 60 letras)." }, { status: 400 });
    if (!ehVisitanteId(corpo?.visitanteId)) return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
    return NextResponse.json(await passeReuniaoVisitante(codigo, nome, corpo.visitanteId));
  } catch (e) {
    if (e instanceof RegistroNaoEncontrado) return NextResponse.json({ erro: "Reunião não encontrada." }, { status: 404 });
    if (e instanceof ReuniaoEncerrada) return NextResponse.json({ erro: "Essa reunião já terminou.", estado: "encerrada" }, { status: 409 });
    if (e instanceof ErroRtk) return NextResponse.json({ erro: "Não conseguimos abrir a sala. Tente de novo." }, { status: 502 });
    throw e;
  }
}
