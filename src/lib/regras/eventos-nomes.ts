/** Nomes e rótulos dos eventos do CRM. Separado de `eventos.ts` porque esse outro arquivo importa
 *  `node:crypto` (pro HMAC) e é usado só no servidor; este aqui não tem nada de Node e pode ser importado por
 *  componente de cliente (ex.: o cartão "CRM" do editor da agenda). */

export const EVENTOS = ["agendou", "lembrete_24h", "lembrete_1h", "comecou", "faltou", "compareceu", "resumo", "comprou"] as const;
export type NomeEvento = (typeof EVENTOS)[number];

/** Eventos que viram mensagem pro lead: só esses vão pra URL de disparo da agenda (ferramenta de disparo pela API
 *  oficial do WhatsApp). */
export const EVENTOS_DISPARO: readonly NomeEvento[] = ["agendou", "lembrete_24h", "lembrete_1h", "comecou", "faltou"];

/** Rótulo completo de cada evento (cartão "CRM" da agenda e tabela de Avisos). */
export const ROTULO_EVENTO: Record<NomeEvento, string> = {
  agendou: "Agendou",
  lembrete_24h: "Lembrete 1 dia antes",
  lembrete_1h: "Lembrete 1 hora antes",
  comecou: "Começou",
  faltou: "Faltou",
  compareceu: "Compareceu",
  resumo: "Resumo da call",
  comprou: "Comprou (venda aprovada)",
};

/** Rótulo curto de cada evento (selo pequeno na coluna "Avisos" da sessão). */
export const ROTULO_EVENTO_CURTO: Record<NomeEvento, string> = {
  agendou: "Agendou",
  lembrete_24h: "1 dia",
  lembrete_1h: "1 hora",
  comecou: "Começou",
  compareceu: "Veio",
  faltou: "Faltou",
  resumo: "Resumo",
  comprou: "Comprou",
};
