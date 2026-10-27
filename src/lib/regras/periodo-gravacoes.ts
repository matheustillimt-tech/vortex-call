import { DateTime } from "luxon";

/** Filtro simples de período da tela de Gravações. A Cloudflare só guarda 7 dias, então não tem opção maior. */
export const PERIODOS_GRAVACOES = ["7dias", "24h", "hoje"] as const;
export type PeriodoGravacoes = (typeof PERIODOS_GRAVACOES)[number];

const FUSO = "America/Sao_Paulo";
const DIA_MS = 86400_000;

export function periodoGravacoesValido(v: unknown): v is PeriodoGravacoes {
  return typeof v === "string" && (PERIODOS_GRAVACOES as readonly string[]).includes(v);
}

/** Texto da query (`?periodo=`) → período válido; qualquer outra coisa cai no padrão "7dias". */
export function periodoGravacoesDe(v: unknown): PeriodoGravacoes {
  return periodoGravacoesValido(v) ? v : "7dias";
}

/** `de` pra `listarGravacoes` (que já usa o padrão de 7 dias quando recebe `null`). "Hoje" é a meia-noite de
 *  Brasília do dia de `agora` (não "as últimas 24 horas corridas"): alguém olhando às 23h de hoje continua vendo
 *  o dia inteiro, não só a última hora. */
export function inicioDoPeriodo(periodo: PeriodoGravacoes, agora: Date): Date | null {
  if (periodo === "24h") return new Date(agora.getTime() - DIA_MS);
  if (periodo === "hoje") return DateTime.fromJSDate(agora, { zone: FUSO }).startOf("day").toJSDate();
  return null;
}
