import { DateTime } from "luxon";

export type Repeticao = { dias_semana: number[]; hora: string; vagas: number; ate: string | null };

/** Instantes (UTC) das sessões de uma regra semanal, de `de` até `semanas` semanas à frente, só futuros.
 *  `dias_semana` usa 0 = domingo … 6 = sábado; `hora` e `ate` valem no fuso. */
export function datasDaRepeticao(r: Repeticao, de: Date, semanas: number, fuso = "America/Sao_Paulo"): Date[] {
  const [h, m] = r.hora.split(":").map(Number);
  const inicio = DateTime.fromJSDate(de, { zone: fuso }).startOf("day");
  const limite = r.ate ? DateTime.fromISO(r.ate, { zone: fuso }).endOf("day") : null;
  const datas: Date[] = [];
  for (let i = 0; i < semanas * 7; i++) {
    const dia = inicio.plus({ days: i });
    if (!r.dias_semana.includes(dia.weekday % 7)) continue;
    const quando = dia.set({ hour: h, minute: m, second: 0, millisecond: 0 });
    if (quando.toMillis() <= de.getTime()) continue;
    if (limite && quando > limite) continue;
    datas.push(quando.toUTC().toJSDate());
  }
  return datas;
}
