import { DateTime } from "luxon";

const FUSO = "America/Sao_Paulo";

/** Sessão como vem de `vitrine_agenda` (o que basta pra saber se ainda dá pra agendar). */
export type SessaoJanela = { id: string; inicio: string; vagas: number; inscritos: number; status: string };

export const JANELA_MIN = 1;
export const JANELA_MAX = 60;

function agendavel(s: SessaoJanela, agora: Date): boolean {
  return s.status === "agendada" && new Date(s.inicio).getTime() > agora.getTime() && s.vagas - s.inscritos > 0;
}

function dia(s: SessaoJanela): string {
  return DateTime.fromISO(s.inicio, { zone: "utc" }).setZone(FUSO).toISODate() ?? "";
}

/** Janela de agendamento da agenda (`agendas.janela_dias`): o lead só vê as sessões dos primeiros N dias (no
 *  calendário de Brasília, a partir de hoje) que ainda têm pelo menos uma sessão agendável (futura, agendada, com
 *  vaga). Dia sem horário (fim de semana) ou só com sessão lotada não conta. Dentro dos dias abertos, as sessões
 *  continuam como vieram (lotada aparece como lotada); passadas e canceladas saem. `null` = sem limite (devolve tudo). */
export function filtrarJanela<T extends SessaoJanela>(sessoes: T[], janelaDias: number | null, agora: Date): T[] {
  if (janelaDias == null) return sessoes;
  const dias = [...new Set(sessoes.filter((s) => agendavel(s, agora)).map(dia))].sort().slice(0, janelaDias);
  const abertos = new Set(dias);
  return sessoes.filter(
    (s) => s.status === "agendada" && new Date(s.inicio).getTime() > agora.getTime() && abertos.has(dia(s)),
  );
}

/** A sessão escolhida está dentro da janela? Sem limite, sempre (a função `inscrever` confere o resto). */
export function sessaoNaJanela(sessoes: SessaoJanela[], sessaoId: string, janelaDias: number | null, agora: Date): boolean {
  if (janelaDias == null) return true;
  return filtrarJanela(sessoes, janelaDias, agora).some((s) => s.id === sessaoId);
}
