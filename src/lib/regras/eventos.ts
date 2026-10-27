import { createHmac } from "node:crypto";
import { formatarSessao } from "./fuso";
import { EVENTOS, EVENTOS_DISPARO, ROTULO_EVENTO, ROTULO_EVENTO_CURTO, type NomeEvento } from "./eventos-nomes";

/** Regras puras dos eventos pro CRM: corpo enviado, tentativas, lembretes e minutos de presença. */

export { EVENTOS, EVENTOS_DISPARO, ROTULO_EVENTO, ROTULO_EVENTO_CURTO, type NomeEvento };
// Minutos de presença moram num arquivo sem node:crypto (o dashboard usa no navegador); reexportados aqui.
export { minutosDePresenca, presencasAteOFim } from "./presenca-minutos";

/** Chave única por evento+inscrição+sessão: muda quando a sessão muda (reagendamento gera outro id). */
export function idEvento(evento: NomeEvento, inscricaoId: string, sessaoId: string): string {
  return `${evento}:${inscricaoId}:${sessaoId}`;
}

/** Chave da linha do disparo (2º destino): a do CRM com prefixo, pra não bater no `unique` da fila. O corpo
 *  enviado continua com o `id_evento` original. */
export function idEventoDisparo(evento: NomeEvento, inscricaoId: string, sessaoId: string): string {
  return `disparo:${idEvento(evento, inscricaoId, sessaoId)}`;
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

export function montarCorpo(o: {
  evento: NomeEvento;
  inscricao: { id: string; codigo: string; nome: string; whatsapp: string; email: string | null; minutos_na_sala?: number };
  sessao: { id: string; titulo: string | null; inicio: string };
  agenda: { slug: string; nome: string };
  site: string;
  agora: Date;
  /** Respostas do formulário guardadas na inscrição: viram `respostas_texto`, uma por linha, pro CRM
   *  usar como {{evento.respostas_texto}} (ex.: anotação do card no Kanban). */
  respostas?: { pergunta: string; resposta: string }[];
  /** Só no evento `resumo`: o texto no formato fixo (vai como {{evento.resumo_texto}} pra anotação do card) e o JSON. */
  resumo?: { texto: string; dados: unknown };
  /** Só no evento `comprou`: a venda (webhook de pagamento) ligada a esta inscrição (vai como {{evento.venda.*}}). */
  venda?: VendaDoEvento;
}): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    evento: o.evento,
    id_evento: idEvento(o.evento, o.inscricao.id, o.sessao.id),
    enviado_em: o.agora.toISOString(),
    agenda: { slug: o.agenda.slug, nome: o.agenda.nome },
    sessao: {
      id: o.sessao.id,
      titulo: o.sessao.titulo ?? o.agenda.nome,
      inicio: o.sessao.inicio,
      inicio_texto: formatarSessao(new Date(o.sessao.inicio), "America/Sao_Paulo"),
    },
    lead: {
      nome: o.inscricao.nome,
      primeiro_nome: primeiroNome(o.inscricao.nome),
      whatsapp: o.inscricao.whatsapp,
      telefone: o.inscricao.whatsapp.replace(/\D/g, ""),
      email: o.inscricao.email,
    },
    link: `${o.site}/c/${o.inscricao.codigo}`,
    link_reagendar: `${o.site}/agendar/${o.agenda.slug}`,
  };
  const linhas = (o.respostas ?? []).filter((r) => r.pergunta && r.resposta).map((r) => `${r.pergunta}: ${r.resposta}`);
  if (linhas.length) corpo.respostas_texto = linhas.join("\n").slice(0, 3900);
  if (o.evento === "compareceu") corpo.minutos_na_sala = o.inscricao.minutos_na_sala ?? 0;
  if (o.evento === "resumo" && o.resumo) {
    corpo.resumo_texto = o.resumo.texto;
    corpo.resumo = o.resumo.dados;
  }
  if (o.evento === "comprou" && o.venda) corpo.venda = corpoDaVenda(o.venda);
  return corpo;
}

export type VendaDoEvento = { pedido: string; produto: string | null; valorCentavos: number; compradaEm: string };

/** `venda` do evento `comprou`: `valor` em reais com ponto (ex.: "3490.12", o que o bloco "Venda aprovada" do CRM lê)
 *  e `valor_texto` pra anotação ("R$ 3.490,12"). */
export function corpoDaVenda(v: VendaDoEvento): Record<string, unknown> {
  const reais = v.valorCentavos / 100;
  return {
    pedido: v.pedido,
    produto: v.produto ?? "",
    valor: reais.toFixed(2),
    valor_texto: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(reais),
    comprada_em: v.compradaEm,
    comprada_em_texto: formatarSessao(new Date(v.compradaEm), "America/Sao_Paulo"),
  };
}

const MINUTOS_POR_TENTATIVA: Record<number, number> = { 1: 1, 2: 5, 3: 15 };

/** Quando tentar de novo depois de `tentativasFeitas` tentativas sem sucesso; `null` a partir da 4ª (falhou de vez). */
export function proximaTentativa(tentativasFeitas: number, agora: Date): Date | null {
  const minutos = MINUTOS_POR_TENTATIVA[tentativasFeitas];
  return minutos === undefined ? null : new Date(agora.getTime() + minutos * 60_000);
}

export function deveLembrar(o: { tipo: "lembrete_24h" | "lembrete_1h"; inicio: Date; inscritoEm: Date; agora: Date }): boolean {
  const inicio = o.inicio.getTime();
  const agora = o.agora.getTime();
  const inscritoEm = o.inscritoEm.getTime();
  const HORA = 60 * 60_000;
  if (o.tipo === "lembrete_24h") {
    return agora >= inicio - 24 * HORA && agora < inicio - HORA && inscritoEm < inicio - 23 * HORA;
  }
  return agora >= inicio - 60 * 60_000 && agora < inicio && inscritoEm < inicio - 50 * 60_000;
}

export function assinarCorpo(segredo: string, corpo: string): string {
  return `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`;
}

/** URL do CRM pra um evento: só https, até 500 caracteres (`agenda.crm_urls` guarda a URL crua digitada no painel). */
export function urlValida(u: string): boolean {
  if (!u || u.length > 500) return false;
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}
