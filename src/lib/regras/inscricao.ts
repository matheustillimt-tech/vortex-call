import { paraE164 } from "./telefone";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

export type PedidoInscricao = {
  sessao: string; nome: string; whatsapp: string; email?: string; resposta?: string; respostas?: unknown;
  utm?: Record<string, string>; origem?: "pagina" | "encaixe";
};

export function validarInscricao(corpo: unknown) {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const sessao = s(c.sessao, 36);
  if (!UUID.test(sessao)) return { erro: "Escolha um horário." };
  const nome = s(c.nome, 120);
  if (!nome) return { erro: "Informe seu nome." };
  const whatsapp = paraE164(s(c.whatsapp, 30));
  if (!whatsapp) return { erro: "Confira o WhatsApp com DDD." };
  const emailBruto = s(c.email, 200).toLowerCase();
  if (emailBruto && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailBruto)) return { erro: "Confira o e-mail." };
  const respostas = c.respostas ?? null;
  if (respostas !== null && JSON.stringify(respostas).length > 5000) return { erro: "Respostas grandes demais." };
  const utmEntrada = (c.utm && typeof c.utm === "object" ? c.utm : {}) as Record<string, unknown>;
  const utm: Record<string, string> = {};
  for (const k of UTMS) {
    const v = s(utmEntrada[k], 200);
    if (v) utm[k] = v;
  }
  return {
    dados: {
      sessao, nome, whatsapp, email: emailBruto || null, resposta: s(c.resposta, 100) || null,
      respostas, utm, origem: c.origem === "encaixe" ? ("encaixe" as const) : ("pagina" as const),
    },
  };
}
