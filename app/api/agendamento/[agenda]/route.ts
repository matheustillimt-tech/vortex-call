import { NextResponse } from "next/server";
import { carregarAgendaPublica } from "@/src/lib/agendamento";
import { CORS } from "@/src/lib/cors";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(_: Request, { params }: { params: Promise<{ agenda: string }> }) {
  const { agenda } = await params;
  let dados;
  try {
    dados = await carregarAgendaPublica(agenda);
  } catch {
    return NextResponse.json({ erro: "Não deu para carregar os horários." }, { status: 500, headers: CORS });
  }
  if (!dados) return NextResponse.json({ erro: "Agenda não encontrada." }, { status: 404, headers: CORS });
  return NextResponse.json(dados, { headers: { ...CORS, "Cache-Control": "no-store" } });
}
