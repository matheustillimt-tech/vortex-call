/** Minutos de presença na sala (sem dependência de Node: usado no servidor e em componentes do navegador). */

/** Presenças que valem pra sessão que acabou em `fim`: quem só entrou a partir do fim não conta. */
export function presencasAteOFim<T extends { entrou: Date }>(intervalos: T[], fim: Date): T[] {
  return intervalos.filter((i) => i.entrou.getTime() < fim.getTime());
}

/** Une intervalos sobrepostos antes de somar (sala pode registrar mais de uma presença da mesma pessoa). Cada
 *  intervalo é cortado em `fim` (saída nula = ficou até o fim) e quem entrou a partir do fim é ignorado. */
export function minutosDePresenca(intervalos: { entrou: Date; saiu: Date | null }[], fim: Date): number {
  const limite = fim.getTime();
  const normalizados = presencasAteOFim(intervalos, fim)
    .map((i) => ({ ini: i.entrou.getTime(), fim: Math.min((i.saiu ?? fim).getTime(), limite) }))
    .filter((i) => i.fim > i.ini)
    .sort((a, b) => a.ini - b.ini);
  if (normalizados.length === 0) return 0;
  let totalMs = 0;
  let atualIni = normalizados[0].ini;
  let atualFim = normalizados[0].fim;
  for (let idx = 1; idx < normalizados.length; idx++) {
    const n = normalizados[idx];
    if (n.ini <= atualFim) {
      atualFim = Math.max(atualFim, n.fim);
    } else {
      totalMs += atualFim - atualIni;
      atualIni = n.ini;
      atualFim = n.fim;
    }
  }
  totalMs += atualFim - atualIni;
  return Math.floor(totalMs / 60_000);
}
