/** Regras puras da reunião instantânea (`/r/{codigo}`): validade, nome do visitante e título. */

export const VALIDADE_REUNIAO_MS = 24 * 60 * 60 * 1000;
export const TITULO_PADRAO = "Reunião rápida";
const TITULO_MAX = 100;

export type SituacaoReuniao = "ativa" | "encerrada" | "vencida";

/** `encerrada` = alguém da equipe encerrou (ou o cron fechou); `vencida` = passou das 24 h e o cron ainda não
 *  marcou. Para quem abre o link, as duas são "já terminou". */
export function situacaoReuniao(r: { encerrada_em: string | null; expira_em: string }, agora: Date = new Date()): SituacaoReuniao {
  if (r.encerrada_em) return "encerrada";
  return agora.getTime() >= new Date(r.expira_em).getTime() ? "vencida" : "ativa";
}

/** Nome digitado pela pessoa de fora: corta espaços das pontas; 2 a 60 caracteres; senão `null`. */
export function limparNomeVisitante(nome: unknown): string | null {
  if (typeof nome !== "string") return null;
  const limpo = nome.trim();
  return limpo.length >= 2 && limpo.length <= 60 ? limpo : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id do visitante gerado no navegador (`crypto.randomUUID()`), guardado por reunião no `localStorage`. */
export function ehVisitanteId(id: unknown): id is string {
  return typeof id === "string" && UUID.test(id);
}

/** Título opcional da reunião: vazio vira "Reunião rápida"; corta espaços e limita a 100 caracteres. */
export function limparTitulo(titulo: unknown): string {
  if (typeof titulo !== "string") return TITULO_PADRAO;
  const limpo = titulo.trim().slice(0, TITULO_MAX).trim();
  return limpo || TITULO_PADRAO;
}
