/** Nota de interação do lead numa sessão (0 a 100). Mesma fórmula da função SQL `nota_interacao`
 *  (migração 20261023170000_dashboard.sql); mudou aqui, muda lá:
 *  40 × min(1, minutos/duração) + 25 × min(1, msgs/5) + 20 × min(1, mic_s/120) + 15 × min(1, cam_s/(duração × 60 × 0,5)),
 *  arredondada. Quem não veio (sem presença) fica com 0. */
export type EntradaNota = {
  minutos: number;
  duracaoMin: number;
  msgs: number;
  micS: number;
  camS: number;
  /** `false` = sem presença na sala (nota 0). Padrão: veio. */
  veio?: boolean;
};

/** "Interagiu" no funil do dashboard. */
export const NOTA_INTERAGIU = 30;

const fracao = (valor: number, total: number) => (total > 0 ? Math.min(1, Math.max(0, valor) / total) : 0);

export function notaInteracao(e: EntradaNota): number {
  if (e.veio === false || !(e.duracaoMin > 0)) return 0;
  const total =
    40 * fracao(e.minutos, e.duracaoMin) +
    25 * fracao(e.msgs, 5) +
    20 * fracao(e.micS, 120) +
    15 * fracao(e.camS, e.duracaoMin * 60 * 0.5);
  // Corta o ruído de ponto flutuante antes de arredondar (o SQL faz round(total, 6) e depois round): 29,4999999 vira 29,5.
  return Math.round(Number(total.toFixed(6)));
}

export function interagiu(nota: number): boolean {
  return nota >= NOTA_INTERAGIU;
}
