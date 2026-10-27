export type EstadoSala = "cancelada" | "acabou" | "espera" | "aguardando_anfitriao" | "aberta";

/** Folga depois do fim programado (início + duração) em que a sala ainda pode ser usada. */
export const MARGEM_FECHAR_MIN = 120;

/** `agendas(duracao_min)` embutido pelo PostgREST: objeto (muitos-pra-um), mas o cliente sem tipos pode dar array.
 *  `null` quando não veio agenda ou duração (dado órfão). */
export function duracaoDaAgenda(agendas: unknown): number | null {
  const a = (Array.isArray(agendas) ? agendas[0] : agendas) as { duracao_min?: number } | null | undefined;
  return typeof a?.duracao_min === "number" ? a.duracao_min : null;
}

/** Fim programado da call: início + duração. */
export function fimProgramado(inicio: Date, duracaoMin: number): Date {
  return new Date(inicio.getTime() + duracaoMin * 60_000);
}

/** Prazo final da sala: fim programado + 2h. Depois disso ninguém entra e a sessão é fechada pelo cron. */
export function prazoFinal(inicio: Date, duracaoMin: number): Date {
  return new Date(inicio.getTime() + (duracaoMin + MARGEM_FECHAR_MIN) * 60_000);
}

/** Decide o que a página `/c/[codigo]` mostra: inscrição cancelada vence qualquer outra regra; depois, sessão
 *  encerrada/cancelada ou que já passou de início+duração+2h conta como "acabou"; antes da janela de abertura
 *  é "espera"; dentro da janela, sem o anfitrião, é "aguardando_anfitriao"; com a sessão "ao_vivo" é "aberta"
 *  (mesmo se o anfitrião abriu antes da janela). */
export function estadoDaSala(o: {
  inscricao: string;
  sessao: string;
  inicio: Date;
  duracaoMin: number;
  abreAntesMin: number;
  agora: Date;
}): { estado: EstadoSala; abreEm: Date; fechaEm: Date } {
  const abreEm = new Date(o.inicio.getTime() - o.abreAntesMin * 60_000);
  const fechaEm = prazoFinal(o.inicio, o.duracaoMin);
  const t = o.agora.getTime();
  let estado: EstadoSala;
  if (o.inscricao === "cancelado") estado = "cancelada";
  else if (o.sessao === "cancelada" || o.sessao === "encerrada" || t >= fechaEm.getTime()) estado = "acabou";
  else if (o.sessao === "ao_vivo") estado = "aberta";
  else if (t < abreEm.getTime()) estado = "espera";
  else estado = "aguardando_anfitriao";
  return { estado, abreEm, fechaEm };
}
