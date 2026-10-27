import { formatarDataHora } from "./fuso";

export const MAX_OBSERVACOES = 10000;

export type ParResposta = { pergunta: string; resposta: string };
export type ItemUtm = { rotulo: string; valor: string };
export type SessaoAnterior = { quando: string; agenda: string; situacao: string };
/** Linha de `inscricoes` com `sessoes(inicio)` e `agendas(nome)` embutidos pelo PostgREST (objeto ou lista). */
export type LinhaAnterior = { status: string; sessoes: unknown; agendas: unknown };

const MAX_PARES = 60;
const MAX_TEXTO = 2000;

function textoDe(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(textoDe).filter(Boolean).join(", ");
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

function cortar(s: string, max = MAX_TEXTO): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Respostas guardadas na inscrição (`inscricoes.respostas`, o que o encaixe mandou) como pergunta → resposta.
 *  Aceita objeto `{pergunta: resposta}`, lista `[{pergunta, resposta}]` ou qualquer um dos dois como texto JSON.
 *  Qualquer outra coisa vira lista vazia (a ficha mostra "Sem respostas de formulário"). */
export function respostasDoFormulario(bruto: unknown): ParResposta[] {
  let valor = bruto;
  if (typeof valor === "string") {
    try {
      valor = JSON.parse(valor);
    } catch {
      return [];
    }
  }
  const pares: ParResposta[] = [];
  const somar = (p: unknown, r: unknown) => {
    const pergunta = textoDe(p);
    const resposta = textoDe(r);
    if (pergunta && resposta) pares.push({ pergunta: cortar(pergunta), resposta: cortar(resposta) });
  };
  if (Array.isArray(valor)) {
    for (const item of valor) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        somar(o.pergunta, o.resposta);
      }
    }
  } else if (valor && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) somar(k, v);
  }
  return pares.slice(0, MAX_PARES);
}

export function linkWhatsapp(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}`;
}

const ORIGENS: Record<string, string> = {
  pagina: "Página de agendamento",
  encaixe: "Agendamento encaixado em outra página",
  painel: "Cadastrada pela equipe",
};

export function rotuloOrigem(origem: string): string {
  return ORIGENS[origem] ?? origem;
}

const UTMS: [string, string][] = [
  ["utm_source", "Fonte"],
  ["utm_medium", "Mídia"],
  ["utm_campaign", "Campanha"],
  ["utm_content", "Conteúdo"],
  ["utm_term", "Termo"],
];

export function listaUtm(utm: unknown): ItemUtm[] {
  if (!utm || typeof utm !== "object" || Array.isArray(utm)) return [];
  const o = utm as Record<string, unknown>;
  return UTMS.flatMap(([chave, rotulo]) => {
    const valor = textoDe(o[chave]);
    return valor ? [{ rotulo, valor }] : [];
  });
}

const SITUACOES: Record<string, string> = { agendado: "Agendou", compareceu: "Veio", faltou: "Faltou", cancelado: "Cancelou" };

export function rotuloSituacao(status: string): string {
  return SITUACOES[status] ?? status;
}

function um<T>(v: unknown): T | null {
  const x = Array.isArray(v) ? v[0] : v;
  return x && typeof x === "object" ? (x as T) : null;
}

/** Outras inscrições da mesma pessoa, da sessão mais recente pra mais antiga. */
export function paraSessoesAnteriores(linhas: LinhaAnterior[], fuso: string): SessaoAnterior[] {
  return linhas
    .map((l) => ({
      inicio: um<{ inicio?: string }>(l.sessoes)?.inicio,
      agenda: um<{ nome?: string }>(l.agendas)?.nome ?? "Agenda",
      status: l.status,
    }))
    .filter((l): l is { inicio: string; agenda: string; status: string } => typeof l.inicio === "string")
    .sort((a, b) => Date.parse(b.inicio) - Date.parse(a.inicio))
    .map((l) => ({ quando: formatarDataHora(new Date(l.inicio), fuso), agenda: l.agenda, situacao: rotuloSituacao(l.status) }));
}

/** Pedido pra IA: só nome e respostas (nunca WhatsApp, e-mail ou UTMs). Resposta esperada: `{"resumo": "..."}`. */
export function montarPromptResumo(o: { nome: string; respostas: ParResposta[] }): { sistema: string; usuario: string } {
  const sistema = [
    "Você prepara um vendedor para uma call de vendas em grupo.",
    "Com base só nas respostas do formulário, escreva UM parágrafo curto (até 4 frases) em português do Brasil dizendo",
    "quem é a pessoa, o que ela quer e a objeção mais provável.",
    "Não invente nada que não esteja nas respostas. Não use travessão. Não use listas nem títulos.",
    'Responda só em JSON, no formato {"resumo": "..."}.',
  ].join(" ");
  const linhas = o.respostas.slice(0, 40).map((p) => `- ${cortar(p.pergunta, 300)}: ${cortar(p.resposta, 600)}`);
  const usuario = `Nome: ${cortar(o.nome.trim(), 120)}\n\nRespostas do formulário:\n${linhas.join("\n")}`;
  return { sistema, usuario };
}

/** Texto final do resumo: sem travessão (regra da casa), espaços normais, até 1.200 caracteres. Vazio → null. */
export function limparResumo(texto: string): string | null {
  const limpo = texto.replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();
  return limpo ? cortar(limpo, 1200) : null;
}

export function extrairResumo(resposta: Record<string, unknown>): string | null {
  return typeof resposta.resumo === "string" ? limparResumo(resposta.resumo) : null;
}
