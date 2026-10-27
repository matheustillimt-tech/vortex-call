import { paraE164 } from "./telefone";

/** Contato do lead mascarado, pra quem não tem a permissão `contato_lead`. O servidor mascara ANTES de mandar pra
 *  tela (o cliente nunca recebe o número/e-mail inteiro). */

const PONTOS = "••••";

/** `+551137651234` → `+55 11 3••••-1234`; fora do Brasil, `+14 ••••-0123`. Curto demais = só a máscara. */
export function mascararWhatsapp(whatsapp: string): string {
  const d = whatsapp.replace(/\D/g, "");
  if (!d) return "";
  if (d.length < 8) return PONTOS;
  const fim = d.slice(-4);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return `+55 ${d.slice(2, 4)} ${d[4]}${PONTOS}-${fim}`;
  return `+${d.slice(0, 2)} ${PONTOS}-${fim}`;
}

/** `maria@exemplo.com` → `m•••@exemplo.com`. Sem e-mail = null. */
export function mascararEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim();
  if (!e) return null;
  const arroba = e.lastIndexOf("@");
  if (arroba < 1) return "•••";
  return `${e[0]}•••${e.slice(arroba)}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SO_TELEFONE = /^[+\d\s().-]+$/;

/** Resposta de formulário: se for um e-mail ou um telefone (ex.: "Qual seu WhatsApp?"), mascara; senão passa igual. */
export function mascararSeContato(texto: string): string {
  const t = texto.trim();
  if (EMAIL.test(t)) return mascararEmail(t) ?? t;
  if (SO_TELEFONE.test(t) && t.replace(/\D/g, "").length >= 10) {
    const e164 = paraE164(t);
    if (e164) return mascararWhatsapp(e164);
  }
  return texto;
}

type FichaComContato = {
  whatsapp: string;
  linkWhatsapp: string;
  email: string | null;
  respostas: { pergunta: string; resposta: string }[];
  resumo?: { estado: string; texto?: string };
  observacoes?: string;
};

/** Ficha da sala sem o contato: WhatsApp e e-mail mascarados, sem link (wa.me/mailto), respostas de contato
 *  mascaradas e telefones/e-mails no meio do resumo da IA e das observações também. Se as observações tinham
 *  contato, voltam travadas (`observacoesTravadas`): salvar o texto mascarado apagaria o contato de verdade, então a
 *  rota recusa e a tela deixa só ler. `contatoMascarado` avisa a tela. */
export function mascararContatoFicha<T extends FichaComContato>(f: T): T & { contatoMascarado: true; observacoesTravadas: boolean } {
  const observacoes = f.observacoes === undefined ? undefined : mascararContatosNoTexto(f.observacoes);
  const resumo = f.resumo?.estado === "pronto" && typeof f.resumo.texto === "string" ? { ...f.resumo, texto: mascararContatosNoTexto(f.resumo.texto) } : f.resumo;
  return {
    ...f,
    whatsapp: mascararWhatsapp(f.whatsapp),
    linkWhatsapp: "",
    email: mascararEmail(f.email),
    respostas: f.respostas.map((r) => ({ ...r, resposta: mascararContatosNoTexto(mascararSeContato(r.resposta)) })),
    ...(resumo !== undefined ? { resumo } : {}),
    ...(observacoes !== undefined ? { observacoes } : {}),
    contatoMascarado: true,
    observacoesTravadas: observacoes !== undefined && observacoes !== f.observacoes,
  };
}

const EMAIL_NO_TEXTO = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[A-Za-z]{2,}(?:\.[A-Za-z]{2,})*/g;
// Sequência com cara de telefone: + opcional, dígitos com espaço/ponto/hífen/parênteses no meio, 10 a 15 dígitos.
const TELEFONE_NO_TEXTO = /(?<![\d/])\+?\(?\d[\d\s().-]{8,20}\d(?![\d/])/g;

/** Texto livre (resumo da IA, observações): telefones e e-mails no meio do texto viram máscara. Datas, valores e
 *  números com menos de 10 dígitos ficam como estão. */
export function mascararContatosNoTexto(texto: string): string {
  if (!texto) return texto;
  const semEmail = texto.replace(EMAIL_NO_TEXTO, (e) => mascararEmail(e) ?? e);
  return semEmail.replace(TELEFONE_NO_TEXTO, (t) => {
    const digitos = t.replace(/\D/g, "");
    if (digitos.length < 10 || digitos.length > 15) return t;
    const e164 = paraE164(t) ?? paraE164(`+${digitos}`);
    return mascararWhatsapp(e164 ?? `+${digitos}`);
  });
}
