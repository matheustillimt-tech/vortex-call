import { NextResponse } from "next/server";
import { ConviteIndisponivel, estadoConvite, passeConvite } from "@/src/lib/convite";
import { hashIp } from "@/src/lib/crypto";
import { dentroDoLimite } from "@/src/lib/limite";
import { ErroRtk } from "@/src/lib/realtimekit";
import { ehConviteValido } from "@/src/lib/regras/convite";
import { ehVisitanteId, limparNomeVisitante } from "@/src/lib/regras/reuniao";
import { RegistroNaoEncontrado } from "@/src/lib/sala";

export const dynamic = "force-dynamic";

const naoEncontrado = () => NextResponse.json({ erro: "Link não encontrado." }, { status: 404 });

function ipDe(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "sem-ip";
}

/** Pública: estado do link de convidado (`aguardando`, `aberta`, `encerrada`) e o nome da call. A tela usa depois
 *  que a pessoa é tirada da sala, pra saber se a call acabou. */
export async function GET(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  if (!ehConviteValido(codigo)) return naoEncontrado();
  if (!(await dentroDoLimite(`convite-estado:${hashIp(ipDe(req))}`, 30))) {
    return NextResponse.json({ erro: "Muitas tentativas. Espere um minuto." }, { status: 429 });
  }
  const estado = await estadoConvite(codigo);
  if (!estado) return naoEncontrado();
  return NextResponse.json(estado);
}

/** Pública: o convidado manda `{ nome, visitanteId }` e entra como participante, só com a sessão ao vivo (409 com o
 *  `estado` fora disso). Ignora vagas e não cria inscrição. Limite de 20 passes por minuto por IP. */
export async function POST(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  if (!ehConviteValido(codigo)) return naoEncontrado();
  if (!(await dentroDoLimite(`convite-entrar:${hashIp(ipDe(req))}`, 20))) {
    return NextResponse.json({ erro: "Muitas tentativas. Espere um minuto." }, { status: 429 });
  }
  const corpo = (await req.json().catch(() => null)) as { nome?: unknown; visitanteId?: unknown } | null;
  const nome = limparNomeVisitante(corpo?.nome);
  if (!nome) return NextResponse.json({ erro: "Digite seu nome (de 2 a 60 letras)." }, { status: 400 });
  if (!ehVisitanteId(corpo?.visitanteId)) return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  try {
    return NextResponse.json(await passeConvite(codigo, nome, corpo.visitanteId));
  } catch (e) {
    if (e instanceof RegistroNaoEncontrado) return naoEncontrado();
    if (e instanceof ConviteIndisponivel) return NextResponse.json({ erro: "A sala não está aberta.", estado: e.estado }, { status: 409 });
    if (e instanceof ErroRtk) return NextResponse.json({ erro: "Não conseguimos abrir a sala. Tente de novo." }, { status: 502 });
    throw e;
  }
}
