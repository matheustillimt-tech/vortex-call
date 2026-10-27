import { NextResponse } from "next/server";
import { enfileirarAvisosEmBreve, enfileirarResumosDiarios, entregarAvisosEquipe } from "@/src/lib/avisos-equipe";
import { segredosIguais } from "@/src/lib/crypto";
import { avaliarSessoes, enfileirarComecouNaHora, enfileirarLembretes } from "@/src/lib/disparos";
import { entregarPendentes } from "@/src/lib/eventos";
import { limparLimites } from "@/src/lib/limite";
import { fecharReunioesVencidas } from "@/src/lib/reunioes";
import { fecharSessoesVencidas } from "@/src/lib/sala";
import { gerarSessoesRepetidas } from "@/src/lib/sessoes-repetidas";
import { limparTranscricoesVelhas } from "@/src/lib/transcricao";

export const maxDuration = 60;
/** A entrega pro CRM roda primeiro e não começa POST novo depois disso (sobra tempo pros outros passos). */
const PRAZO_ENTREGA_MS = 40_000;
/** Os avisos pro vendedor (poucos) saem depois dos passos críticos, sem começar POST novo depois de 45 s do começo do
 *  tick: com o tempo limite de 5 s por POST, o tick termina antes de ~50 s. */
const PRAZO_AVISOS_EQUIPE_MS = 45_000;

function autenticado(req: Request): boolean {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  const segredo = process.env.CRON_SECRET;
  return !!m && !!segredo && segredosIguais(m[1], segredo);
}

/** Roda um passo do cron; se falhar, loga e devolve `padrao` pra que os outros passos rodem mesmo assim. */
async function passo<T>(nome: string, fn: () => Promise<T>, padrao: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error("[cron] passo falhou", nome, e instanceof Error ? e.message : "erro");
    return padrao;
  }
}

/** Vercel Cron, a cada minuto. Primeiro entrega os eventos pendentes pro CRM (até 40 s depois do começo
 *  do tick, 5 por vez, 5 s cada), pra que um CRM lento nunca estoure o limite de 60 s com os outros passos.
 *  Depois dos passos críticos, os avisos pro vendedor (nenhum POST novo depois de 45 s) e, no fim, enfileira o
 *  "em breve" (10 min antes) e o resumo das 08:00.
 *  Depois gera as sessões das repetições, limpa limites e transcrições com mais de 90 dias, fecha sessões `ao_vivo` esquecidas (passaram de
 *  início + duração + 2h) e reuniões instantâneas com as 24 h vencidas, enfileira os lembretes e o "começou" (na
 *  hora marcada) e avalia a
 *  presença das sessões que acabaram (o que entra na fila agora sai no próximo tick). */
export async function GET(req: Request) {
  if (!autenticado(req)) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  const inicioTick = Date.now();
  const { enviados, falhas } = await passo(
    "entregarPendentes",
    () => entregarPendentes(new Date(inicioTick), undefined, new Date(inicioTick + PRAZO_ENTREGA_MS)),
    { enviados: 0, falhas: 0 },
  );
  const sessoesCriadas = await passo("gerarSessoesRepetidas", () => gerarSessoesRepetidas(), 0);
  const limitesApagados = await passo("limparLimites", () => limparLimites(), 0);
  const transcricoesApagadas = await passo("limparTranscricoesVelhas", () => limparTranscricoesVelhas(), 0);
  const sessoesFechadas = await passo("fecharSessoesVencidas", () => fecharSessoesVencidas(), 0);
  const reunioesFechadas = await passo("fecharReunioesVencidas", () => fecharReunioesVencidas(), 0);
  const lembretes = await passo("enfileirarLembretes", () => enfileirarLembretes(), 0);
  const comecou = await passo("enfileirarComecouNaHora", () => enfileirarComecouNaHora(), 0);
  const sessoesAvaliadas = await passo("avaliarSessoes", () => avaliarSessoes(), 0);
  const equipe = await passo(
    "entregarAvisosEquipe",
    () => entregarAvisosEquipe(new Date(), undefined, new Date(inicioTick + PRAZO_AVISOS_EQUIPE_MS)),
    { enviados: 0, falhas: 0 },
  );
  const avisosEmBreve = await passo("enfileirarAvisosEmBreve", () => enfileirarAvisosEmBreve(), 0);
  const resumosDiarios = await passo("enfileirarResumosDiarios", () => enfileirarResumosDiarios(), 0);
  return NextResponse.json({
    sessoesCriadas, limitesApagados, transcricoesApagadas, sessoesFechadas, reunioesFechadas,
    lembretes, comecou, sessoesAvaliadas, eventosEnviados: enviados, eventosFalhos: falhas,
    avisosEquipeEnviados: equipe.enviados, avisosEquipeFalhos: equipe.falhas, avisosEmBreve, resumosDiarios,
  });
}
