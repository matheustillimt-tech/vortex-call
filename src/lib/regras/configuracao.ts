import { urlValida } from "./eventos";
import { paraE164 } from "./telefone";

export function validarConfiguracao(form: FormData) {
  const t = (k: string) => String(form.get(k) ?? "").trim();
  const nome = t("nome");
  if (!nome) return { erro: "Informe o nome da marca." };
  const cor = t("cor_marca").toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(cor)) return { erro: "Cor no formato #RRGGBB." };
  const logo = t("logo_url");
  if (logo && !/^https:\/\/\S+$/.test(logo)) return { erro: "Logo precisa ser um link https." };
  const wa = t("whatsapp_suporte");
  const whatsapp = wa ? paraE164(wa) : null;
  if (wa && !whatsapp) return { erro: "Confira o WhatsApp de suporte." };
  return { dados: { nome, logo_url: logo || null, cor_marca: cor, whatsapp_suporte: whatsapp } };
}

const SEGREDO_MAX = 200;

/** Cartão "Avisos pra equipe": URL única do CRM pros avisos do vendedor (https, até 500 caracteres; vazia
 *  desliga) e o segredo (`X-Webhook-Secret`). Segredo em branco mantém o atual (`undefined`); a caixa
 *  `crm_remover_segredo_equipe` limpa (`null`). */
export function lerCrmEquipe(form: FormData): { crm_url_equipe: string | null; crm_segredo_equipe?: string | null; erro?: string } {
  const url = String(form.get("crm_url_equipe") ?? "").trim();
  if (url && !urlValida(url)) return { crm_url_equipe: null, erro: "URL dos avisos da equipe: use um endereço https:// de até 500 caracteres." };
  const segredo = String(form.get("crm_segredo_equipe") ?? "").trim();
  if (segredo.length > SEGREDO_MAX) return { crm_url_equipe: null, erro: `Segredo: até ${SEGREDO_MAX} caracteres.` };
  const r: { crm_url_equipe: string | null; crm_segredo_equipe?: string | null } = { crm_url_equipe: url || null };
  if (form.get("crm_remover_segredo_equipe") === "on") r.crm_segredo_equipe = null;
  else if (segredo) r.crm_segredo_equipe = segredo;
  return r;
}
