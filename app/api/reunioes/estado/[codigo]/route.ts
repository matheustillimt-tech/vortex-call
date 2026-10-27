import { NextResponse } from "next/server";
import { hashIp } from "@/src/lib/crypto";
import { dentroDoLimite } from "@/src/lib/limite";
import { estadoReuniao } from "@/src/lib/reunioes";

export const dynamic = "force-dynamic";

/** Público: estado da reunião (`ativa` ou `encerrada`) e título. Nada de quem criou nem dados da sala. */
export async function GET(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "sem-ip";
  if (!(await dentroDoLimite(`reuniao-estado:${hashIp(ip)}`, 60))) {
    return NextResponse.json({ erro: "Muitas tentativas. Espere um minuto." }, { status: 429 });
  }
  const r = await estadoReuniao(codigo);
  if (!r) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });
  return NextResponse.json(r);
}
