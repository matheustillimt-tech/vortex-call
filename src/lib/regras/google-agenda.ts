function dataGoogle(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function linkGoogleAgenda(o: { titulo: string; inicio: Date; fim: Date; detalhes: string }): string {
  const u = new URL("https://calendar.google.com/calendar/render");
  u.searchParams.set("action", "TEMPLATE");
  u.searchParams.set("text", o.titulo);
  u.searchParams.set("dates", `${dataGoogle(o.inicio)}/${dataGoogle(o.fim)}`);
  u.searchParams.set("details", o.detalhes);
  return u.toString();
}
