import { DateTime } from "luxon";
import type { ParResposta } from "./ficha";
import { formatarHora, formatarSessao } from "./fuso";

/** Regras puras dos avisos pro vendedor (WhatsApp pelo CRM, URL única `configuracao.crm_url_equipe`): ids,
 *  janelas de envio e o corpo enviado (vendedor + `mensagem` com texto fixo, sem IA nem markdown, links sozinhos na
 *  linha + `dados` estruturados). O fluxo do CRM mapeia `vendedor.telefone` → telefone, `vendedor.nome` → nome e manda
 *  `{{evento.mensagem}}`. */

const FUSO = "America/Sao_Paulo";
const MIN = 60_000;
export const MINUTOS_EM_BREVE = 10;
/** O resumo diário sai a partir das 08:00 (Brasília); até as 10:00 ainda dá tempo se o cron falhou um pouco. */
const HORA_RESUMO = 8;
const HORA_RESUMO_LIMITE = 10;
const MAX_RESUMO_IA = 280;
const MAX_RESPOSTAS = 3;
const MAX_RESPOSTA = 100;

export const EVENTOS_EQUIPE = ["vendedor_novo_agendamento", "vendedor_sessao_em_breve", "vendedor_resumo_diario"] as const;
export type EventoEquipe = (typeof EVENTOS_EQUIPE)[number];

export type CorpoAvisoEquipe = {
  evento: EventoEquipe;
  id_evento: string;
  enviado_em: string;
  vendedor: { nome: string; primeiro_nome: string; telefone: string; whatsapp: string };
  mensagem: string;
  dados: Record<string, unknown>;
};

type Vendedor = { nome: string; whatsapp: string };
type SessaoAviso = { id: string; titulo: string | null; inicio: string };
type AgendaAviso = { id: string; nome: string; slug: string };

export function idAvisoEquipe(
  o:
    | { evento: "vendedor_novo_agendamento"; inscricao: string; sessao: string; agendadoEm: string }
    | { evento: "vendedor_sessao_em_breve"; sessao: string }
    | { evento: "vendedor_resumo_diario"; usuario: string; dia: string },
): string {
  // `agendado_em` muda a cada (re)agendamento: A→B→A gera outro aviso; a mesma ação repetida (ou o reenvio) não.
  if (o.evento === "vendedor_novo_agendamento") return `${o.evento}:${o.inscricao}:${o.sessao}:${Date.parse(o.agendadoEm)}`;
  if (o.evento === "vendedor_sessao_em_breve") return `${o.evento}:${o.sessao}`;
  return `${o.evento}:${o.usuario}:${o.dia}`;
}

export function linkAnfitriao(site: string, sessaoId: string): string {
  return `${site}/equipe/sala/${sessaoId}?modo=anfitriao`;
}

export function linkSessao(site: string, sessaoId: string): string {
  return `${site}/sessoes/${sessaoId}`;
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

function cortar(t: string, max: number): string {
  const s = t.trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function dadosDoVendedor(v: Vendedor): CorpoAvisoEquipe["vendedor"] {
  return { nome: v.nome, primeiro_nome: primeiroNome(v.nome), telefone: v.whatsapp.replace(/\D/g, ""), whatsapp: v.whatsapp };
}

function dadosDaSessao(s: SessaoAviso, agenda: AgendaAviso) {
  return { id: s.id, titulo: s.titulo ?? agenda.nome, inicio: s.inicio, inicio_texto: formatarSessao(new Date(s.inicio), FUSO) };
}

/** Resumo curto do lead pro vendedor: o resumo da IA (até 280 caracteres), senão até 3 respostas do formulário
 *  (cada resposta até 100), senão null. */
export function resumoDaFicha(o: { resumoIa: string | null | undefined; respostas: ParResposta[] }): string | null {
  const ia = o.resumoIa?.trim();
  if (ia) return cortar(ia, MAX_RESUMO_IA);
  const pares = o.respostas.filter((p) => p.pergunta && p.resposta).slice(0, MAX_RESPOSTAS);
  if (pares.length === 0) return null;
  return pares.map((p) => `${cortar(p.pergunta, 60)}: ${cortar(p.resposta, MAX_RESPOSTA)}`).join("\n");
}

/** Lead agendou (ou reagendou pra outra sessão) numa agenda do vendedor. */
export function corpoNovoAgendamento(o: {
  vendedor: Vendedor;
  lead: { id: string; nome: string; whatsapp: string; email: string | null; agendado_em: string };
  sessao: SessaoAviso;
  agenda: AgendaAviso;
  resumo: string | null;
  reagendou: boolean;
  site: string;
  agora: Date;
}): CorpoAvisoEquipe {
  const vendedor = dadosDoVendedor(o.vendedor);
  const sessao = dadosDaSessao(o.sessao, o.agenda);
  const anfitriao = linkAnfitriao(o.site, o.sessao.id);
  const painel = linkSessao(o.site, o.sessao.id);
  const abertura = o.reagendou
    ? `${vendedor.primeiro_nome}, um lead reagendou pra sua agenda "${o.agenda.nome}".`
    : `${vendedor.primeiro_nome}, novo agendamento na sua agenda "${o.agenda.nome}".`;
  const linhas = [abertura, "", `Lead: ${o.lead.nome}`, `WhatsApp: ${o.lead.whatsapp}`, `Quando: ${sessao.inicio_texto}`];
  if (sessao.titulo !== o.agenda.nome) linhas.push(`Sessão: ${sessao.titulo}`);
  if (o.resumo) linhas.push("", "Sobre o lead:", o.resumo);
  linhas.push("", "Entrar na sala como anfitrião:", anfitriao, "", "Ver a sessão no painel:", painel);
  return {
    evento: "vendedor_novo_agendamento",
    id_evento: idAvisoEquipe({ evento: "vendedor_novo_agendamento", inscricao: o.lead.id, sessao: o.sessao.id, agendadoEm: o.lead.agendado_em }),
    enviado_em: o.agora.toISOString(),
    vendedor,
    mensagem: linhas.join("\n"),
    dados: {
      reagendou: o.reagendou,
      agenda: { id: o.agenda.id, nome: o.agenda.nome, slug: o.agenda.slug },
      sessao,
      lead: { nome: o.lead.nome, whatsapp: o.lead.whatsapp, email: o.lead.email, resumo: o.resumo },
      link_anfitriao: anfitriao,
      link_sessao: painel,
    },
  };
}

const inscritosTexto = (n: number) => `${n} ${n === 1 ? "inscrito" : "inscritos"}`;

function minutosAte(inicio: Date, agora: Date): number {
  return Math.max(1, Math.ceil((inicio.getTime() - agora.getTime()) / MIN));
}

function primeiraLinhaEmBreve(primeiroNome: string, hora: string, minutos: number, inscritos: number): string {
  return `${primeiroNome}, sua call das ${hora} começa em ${minutos} min, ${inscritosTexto(inscritos)}.`;
}

/** ~10 min antes de uma sessão com gente inscrita. */
export function corpoEmBreve(o: {
  vendedor: Vendedor;
  sessao: SessaoAviso;
  agenda: AgendaAviso;
  inscritos: number;
  site: string;
  agora: Date;
}): CorpoAvisoEquipe {
  const vendedor = dadosDoVendedor(o.vendedor);
  const sessao = dadosDaSessao(o.sessao, o.agenda);
  const inicio = new Date(o.sessao.inicio);
  const minutos = minutosAte(inicio, o.agora);
  const hora = formatarHora(inicio, FUSO);
  const anfitriao = linkAnfitriao(o.site, o.sessao.id);
  return {
    evento: "vendedor_sessao_em_breve",
    id_evento: idAvisoEquipe({ evento: "vendedor_sessao_em_breve", sessao: o.sessao.id }),
    enviado_em: o.agora.toISOString(),
    vendedor,
    mensagem: [
      primeiraLinhaEmBreve(vendedor.primeiro_nome, hora, minutos, o.inscritos),
      sessao.titulo,
      "",
      "Entrar na sala como anfitrião:",
      anfitriao,
    ].join("\n"),
    dados: {
      agenda: { id: o.agenda.id, nome: o.agenda.nome, slug: o.agenda.slug },
      sessao,
      hora,
      minutos,
      inscritos: o.inscritos,
      link_anfitriao: anfitriao,
      link_sessao: linkSessao(o.site, o.sessao.id),
    },
  };
}

/** Na entrega: refaz "começa em N min" com a hora do envio (o aviso pode ter ficado na fila). */
export function atualizarEmBreve<T extends { vendedor: unknown; mensagem: unknown; dados: unknown }>(corpo: T, agora: Date): T {
  const d = (corpo.dados ?? {}) as { sessao?: { inicio?: string }; hora?: string; inscritos?: number };
  const v = (corpo.vendedor ?? {}) as { primeiro_nome?: string };
  if (!d.sessao?.inicio || typeof d.hora !== "string" || typeof corpo.mensagem !== "string") return corpo;
  const minutos = minutosAte(new Date(d.sessao.inicio), agora);
  const linhas = corpo.mensagem.split("\n");
  linhas[0] = primeiraLinhaEmBreve(v.primeiro_nome ?? "", d.hora, minutos, Number(d.inscritos) || 0);
  return { ...corpo, mensagem: linhas.join("\n"), dados: { ...(corpo.dados as object), minutos } };
}

export type SessaoDoDia = { id: string; titulo: string | null; inicio: string; agenda: string; inscritos: number };

/** Resumo das calls do dia do vendedor (só sai se ele tem sessão hoje: quem chama não manda lista vazia). */
export function corpoResumoDiario(o: {
  vendedor: Vendedor & { id: string };
  dia: string;
  sessoes: SessaoDoDia[];
  site: string;
  agora: Date;
}): CorpoAvisoEquipe {
  const vendedor = dadosDoVendedor(o.vendedor);
  const diaTexto = DateTime.fromISO(o.dia, { zone: FUSO }).setLocale("pt-BR").toFormat("cccc, dd/MM");
  const ordenadas = [...o.sessoes].sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));
  const itens = ordenadas.map((s) => ({
    id: s.id,
    titulo: s.titulo ?? s.agenda,
    agenda: s.agenda,
    inicio: s.inicio,
    hora: formatarHora(new Date(s.inicio), FUSO),
    inscritos: s.inscritos,
    link_anfitriao: linkAnfitriao(o.site, s.id),
    link_sessao: linkSessao(o.site, s.id),
  }));
  const linhas = [`Bom dia, ${vendedor.primeiro_nome}! Suas calls de hoje (${diaTexto}):`];
  for (const s of itens) linhas.push("", `${s.hora} · ${s.titulo} · ${inscritosTexto(s.inscritos)}`, s.link_anfitriao);
  linhas.push("", "Todas as sessões no painel:", `${o.site}/sessoes`);
  return {
    evento: "vendedor_resumo_diario",
    id_evento: idAvisoEquipe({ evento: "vendedor_resumo_diario", usuario: o.vendedor.id, dia: o.dia }),
    enviado_em: o.agora.toISOString(),
    vendedor,
    mensagem: linhas.join("\n"),
    dados: {
      dia: o.dia,
      dia_texto: diaTexto,
      total_sessoes: itens.length,
      total_inscritos: itens.reduce((t, s) => t + s.inscritos, 0),
      sessoes: itens,
    },
  };
}

/** Janela do "em breve": dos 10 min antes do início até o início. */
export function deveAvisarEmBreve(inicio: Date, agora: Date): boolean {
  const t = agora.getTime();
  return t >= inicio.getTime() - MINUTOS_EM_BREVE * MIN && t < inicio.getTime();
}

/** Se agora é hora do resumo diário (08:00 a 09:59 em Brasília), o dia (`YYYY-MM-DD`) e o intervalo UTC dele. */
export function diaDoResumo(agora: Date): { dia: string; de: Date; ate: Date } | null {
  const local = DateTime.fromJSDate(agora, { zone: FUSO });
  if (local.hour < HORA_RESUMO || local.hour >= HORA_RESUMO_LIMITE) return null;
  const inicio = local.startOf("day");
  return { dia: inicio.toFormat("yyyy-MM-dd"), de: inicio.toJSDate(), ate: inicio.plus({ days: 1 }).toJSDate() };
}
