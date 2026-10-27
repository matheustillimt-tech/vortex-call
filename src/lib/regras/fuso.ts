import { DateTime, IANAZone } from "luxon";

/** Fusos oferecidos no painel. O primeiro é o padrão. */
export const FUSOS: { valor: string; rotulo: string }[] = [
  { valor: "America/Sao_Paulo", rotulo: "(GMT-03:00) Brasília" },
  { valor: "America/Noronha", rotulo: "(GMT-02:00) Fernando de Noronha" },
  { valor: "America/Manaus", rotulo: "(GMT-04:00) Manaus" },
  { valor: "America/Rio_Branco", rotulo: "(GMT-05:00) Acre" },
  { valor: "Europe/Lisbon", rotulo: "Lisboa" },
  { valor: "Europe/London", rotulo: "Londres" },
  { valor: "Europe/Madrid", rotulo: "Madri" },
  { valor: "Europe/Paris", rotulo: "Paris" },
  { valor: "Africa/Maputo", rotulo: "Moçambique" },
  { valor: "America/New_York", rotulo: "Nova York" },
  { valor: "America/Chicago", rotulo: "Chicago" },
  { valor: "America/Denver", rotulo: "Denver" },
  { valor: "America/Los_Angeles", rotulo: "Los Angeles" },
  { valor: "America/Mexico_City", rotulo: "Cidade do México" },
  { valor: "America/Bogota", rotulo: "Bogotá" },
  { valor: "America/Argentina/Buenos_Aires", rotulo: "Buenos Aires" },
  { valor: "Asia/Tokyo", rotulo: "Tóquio" },
];

export function ehFusoValido(f: string): boolean {
  return IANAZone.isValidZone(f);
}

/** `YYYY-MM-DDTHH:mm` digitado no fuso → instante UTC. */
export function localParaUtc(valor: string, fuso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) return null;
  const d = DateTime.fromISO(valor, { zone: fuso });
  return d.isValid ? d.toJSDate() : null;
}

/** Instante UTC → `YYYY-MM-DDTHH:mm` no fuso (valor de `<input type="datetime-local">`). */
export function utcParaLocal(data: Date, fuso: string): string {
  return DateTime.fromJSDate(data, { zone: fuso }).toFormat("yyyy-MM-dd'T'HH:mm");
}

export function formatarSessao(data: Date, fuso: string): string {
  return DateTime.fromJSDate(data, { zone: fuso }).setLocale("pt-BR").toFormat("cccc, dd/MM 'às' HH:mm");
}

/** Só a hora (`HH:mm`) de um instante, no fuso dado. */
export function formatarHora(data: Date, fuso: string): string {
  return DateTime.fromJSDate(data, { zone: fuso }).toFormat("HH:mm");
}

/** Data e hora (`27/10/2026 às 09:00`) de um instante, no fuso dado. */
export function formatarDataHora(data: Date, fuso: string): string {
  return DateTime.fromJSDate(data, { zone: fuso }).toFormat("dd/MM/yyyy 'às' HH:mm");
}
