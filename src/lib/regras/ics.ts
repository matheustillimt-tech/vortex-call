/** Arquivo de calendário (.ics, RFC 5545) de uma sessão do just in time: gerado no navegador da pessoa a partir do
 *  título, início, fim e link da sala ("Adicionar à agenda" da página de inscrição confirmada). */

function dataIcs(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escapa texto de propriedade (`\`, `;`, `,` e quebras de linha) e tira caracteres de controle. */
function textoIcs(s: string): string {
  return s
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Dobra linhas acima de 75 octetos (aqui: 73 caracteres, folga para acentos) como pede a RFC. */
function dobrar(linha: string): string {
  const partes: string[] = [];
  for (let i = 0; i < linha.length; i += 73) partes.push(linha.slice(i, i + 73));
  return partes.join("\r\n ");
}

export function gerarIcs(o: { titulo: string; inicio: Date; fim: Date; link: string; uid: string; agora: Date }): string {
  const linhas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vórtex Call//JIT//PT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${textoIcs(o.uid)}`,
    `DTSTAMP:${dataIcs(o.agora)}`,
    `DTSTART:${dataIcs(o.inicio)}`,
    `DTEND:${dataIcs(o.fim)}`,
    `SUMMARY:${textoIcs(o.titulo)}`,
    `DESCRIPTION:${textoIcs(o.link)}`,
    `URL:${o.link.replace(/[\u0000-\u001f\u007f]/g, "")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return linhas.map(dobrar).join("\r\n") + "\r\n";
}
