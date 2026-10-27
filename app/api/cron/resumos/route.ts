import { NextResponse } from "next/server";
import { segredosIguais } from "@/src/lib/crypto";
import { gerarProximoResumo } from "@/src/lib/resumo-final";

// A IA pode levar até ~45 s com a transcrição de uma call longa: rotina própria, uma sessão por minuto, pra não
// apertar o tick (`/api/cron/tick`).
export const maxDuration = 60;

function autenticado(req: Request): boolean {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  const segredo = process.env.CRON_SECRET;
  return !!m && !!segredo && segredosIguais(m[1], segredo);
}

/** Vercel Cron, a cada minuto: gera o resumo final de uma sessão transcrita da fila (`gerarProximoResumo`). */
export async function GET(req: Request) {
  if (!autenticado(req)) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  try {
    return NextResponse.json({ resultado: await gerarProximoResumo() });
  } catch (e) {
    console.error("[cron resumos] falhou", e instanceof Error ? e.message : "erro");
    return NextResponse.json({ erro: "falhou" }, { status: 500 });
  }
}
