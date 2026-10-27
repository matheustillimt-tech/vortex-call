import { NextResponse } from "next/server";
import { hashIp } from "@/src/lib/crypto";
import { dentroDoLimite } from "@/src/lib/limite";
import { estadoPorCodigo } from "@/src/lib/sala";

export const dynamic = "force-dynamic";

/** Polling da tela `/c/[codigo]`: sem dados pessoais, só o que decide o que mostrar. */
export async function GET(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "sem-ip";
  if (!(await dentroDoLimite(`sala-estado:${hashIp(ip)}`, 60))) {
    return NextResponse.json({ erro: "Muitas tentativas. Espere um minuto." }, { status: 429 });
  }
  const r = await estadoPorCodigo(codigo);
  if (!r) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });
  return NextResponse.json(r);
}
