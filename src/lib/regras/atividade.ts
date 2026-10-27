export type AtividadeLead = { mic_s: number; cam_s: number; msgs: number };

/** Segundos pra tela do painel: "—" (zero), "45 s", "3 min 05 s", "1 h 02 min". */
export function formatarSegundos(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  if (s === 0) return "—";
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const resto = s % 60;
    return resto ? `${Math.floor(s / 60)} min ${String(resto).padStart(2, "0")} s` : `${Math.floor(s / 60)} min`;
  }
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}

