import type { NomeEvento } from "./eventos-nomes";
import type { ParResposta } from "./ficha";

/** Regras puras da mensagem de WhatsApp que vai pronta em cada evento pro CRM (`mensagem` no corpo) e dos
 *  `campos` planos pro contato: dados tirados do corpo, links obrigatórios, texto fixo (reserva quando a IA não
 *  responde), pedido pra IA e validação do que ela devolve. */

export const MAX_MENSAGEM = 600;
const MAX_CONTEXTO_RESUMO = 400;
const MAX_RESPOSTAS_CONTEXTO = 4;

/** O que a mensagem usa, tirado do corpo enfileirado. */
export type DadosMensagem = { primeiroNome: string; agenda: string; inicioTexto: string; link: string; linkReagendar: string };

export type CamposContato = {
  call_agenda: string;
  call_horario: string;
  call_link: string;
  call_reagendar: string;
  call_status: string;
};

const STATUS_CAMPO: Record<NomeEvento, string> = {
  agendou: "agendado",
  lembrete_24h: "lembrete",
  lembrete_1h: "lembrete",
  comecou: "começou",
  faltou: "faltou",
  compareceu: "compareceu",
  resumo: "compareceu",
  comprou: "comprou",
};

function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Lê do corpo (montado por `montarCorpo` na hora de enfileirar) o que a mensagem e os campos precisam. Corpo velho ou
 *  incompleto vira texto vazio, nunca lança (a entrega não pode parar por isso). */
export function dadosDoCorpo(corpo: Record<string, unknown>): DadosMensagem {
  return {
    primeiroNome: texto(objeto(corpo.lead).primeiro_nome).trim(),
    agenda: texto(objeto(corpo.agenda).nome),
    inicioTexto: texto(objeto(corpo.sessao).inicio_texto),
    link: texto(corpo.link),
    linkReagendar: texto(corpo.link_reagendar),
  };
}

/** Como a call é chamada pro lead: sempre "apresentação" (agenda com "apresentação" no nome) ou
 *  "diagnóstico" (todas as outras). O nome interno da agenda ("Call de vendas"…) nunca vai pro lead. */
export type NomeCall = { nome: "diagnóstico" | "apresentação"; seu: "seu" | "sua"; pro: "pro" | "pra"; marcado: "marcado" | "marcada" };

export function nomeDaCall(agenda: string): NomeCall {
  return /apresenta[cç][aã]o/i.test(agenda)
    ? { nome: "apresentação", seu: "sua", pro: "pra", marcado: "marcada" }
    : { nome: "diagnóstico", seu: "seu", pro: "pro", marcado: "marcado" };
}

/** Campos planos pra salvar no contato do CRM (mapeamento `campos.call_*` no fluxo). */
export function montarCampos(evento: NomeEvento, d: DadosMensagem): CamposContato {
  return {
    call_agenda: nomeDaCall(d.agenda).nome,
    call_horario: d.inicioTexto,
    call_link: d.link,
    call_reagendar: d.linkReagendar,
    call_status: STATUS_CAMPO[evento],
  };
}

/** Links que a mensagem do evento TEM que levar, exatamente como estão: sala nos lembretes e no "começou",
 *  reagendar só no "faltou". "Compareceu", "resumo" e "comprou" não mandam mensagem. */
export function linksObrigatorios(evento: NomeEvento, d: DadosMensagem): string[] {
  switch (evento) {
    case "agendou":
    case "lembrete_24h":
    case "lembrete_1h":
    case "comecou":
      return [d.link];
    case "faltou":
      return [d.linkReagendar];
    case "compareceu":
    case "resumo":
    case "comprou":
      return [];
  }
}

/** Texto fixo de cada evento (o do guia `docs/avisos-crm.md`): vale quando a IA não está configurada, falha,
 *  demora ou devolve algo que não passa na validação. Link sempre no fim da linha (sem pontuação colada, pra o
 *  WhatsApp não quebrar o link). "Compareceu", "resumo" e "comprou" → vazio (não mandam mensagem). */
export function mensagemPadrao(evento: NomeEvento, d: DadosMensagem): string {
  const n = d.primeiroNome;
  const c = nomeDaCall(d.agenda);
  const Seu = c.seu === "seu" ? "Seu" : "Sua";
  switch (evento) {
    case "agendou":
      return `${n ? `Prontinho, ${n}!` : "Prontinho!"} ${Seu} ${c.nome} ficou ${c.marcado} pra ${d.inicioTexto}.\n\nLink pra entrar: ${d.link}`;
    case "lembrete_24h":
      return `${n ? `Oi, ${n}!` : "Oi!"} Passando pra lembrar: ${c.seu} ${c.nome} é ${d.inicioTexto}. Guarda o link pra entrar: ${d.link}`;
    case "lembrete_1h":
      return `${n ? `${n}, falta` : "Falta"} menos de 1 hora ${c.pro} ${c.seu} ${c.nome}! Entra pelo link na hora certa: ${d.link}`;
    case "comecou":
      return `${Seu} ${c.nome} está começando agora${n ? `, ${n}` : ""}! Entra pelo link: ${d.link}`;
    case "faltou":
      return `${n ? `${n}, vi` : "Vi"} que não deu pra vir hoje. Sem problema! Escolhe outro horário aqui: ${d.linkReagendar}`;
    case "compareceu":
    case "resumo":
    case "comprou":
      return "";
  }
}

/** Limpa o texto da IA (sem negrito/itálico de markdown, sem travessão, espaços e linhas em branco normais) e
 *  confere: não vazio, até 600 caracteres, sem preço, sem a palavra venda (o nome interno da agenda pode ter) e com todos os links obrigatórios exatamente iguais. Não
 *  passou → `null` (aí vale o texto fixo). */
export function validarMensagem(bruto: string, links: string[]): string | null {
  const limpo = bruto
    .replace(/\r/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/[ \t]*[—–][ \t]*/g, ", ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!limpo || limpo.length > MAX_MENSAGEM) return null;
  if (/R\$\s?\d/.test(limpo)) return null;
  if (/\bvendas?\b/i.test(limpo.replace(/https?:\/\/\S+/g, ""))) return null;
  return links.every((l) => limpo.includes(l)) ? limpo : null;
}

/** Resposta esperada da IA: `{"mensagem": "..."}`. */
export function extrairMensagem(resposta: Record<string, unknown>, links: string[]): string | null {
  return typeof resposta.mensagem === "string" ? validarMensagem(resposta.mensagem, links) : null;
}

function cortar(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Contexto curto sobre a pessoa pra IA dar um toque pessoal: o resumo da ficha (IA) se já existir, senão
 *  até 4 respostas do formulário bem cortadas. Nada → `null`. Nunca WhatsApp, e-mail nem UTM. */
export function contextoDaFicha(resumo: string | null | undefined, respostas: ParResposta[]): string | null {
  const r = (resumo ?? "").trim();
  if (r) return cortar(r, MAX_CONTEXTO_RESUMO);
  if (respostas.length === 0) return null;
  return respostas
    .slice(0, MAX_RESPOSTAS_CONTEXTO)
    .map((p) => `${cortar(p.pergunta, 80)}: ${cortar(p.resposta, 150)}`)
    .join("; ");
}

const SITUACAO: Record<Exclude<NomeEvento, "compareceu" | "resumo" | "comprou">, string> = {
  agendou: "A pessoa acabou de marcar a call. Confirme o dia e a hora e mande o link da sala.",
  lembrete_24h: "A call é amanhã (falta cerca de 1 dia). Lembre o dia e a hora e mande o link da sala.",
  lembrete_1h: "Falta menos de 1 hora pra call. Crie expectativa e mande o link da sala pra entrar na hora.",
  comecou: "Chegou o horário marcado e a call está começando agora. Chame a pessoa pra entrar já pelo link da sala (se a equipe ainda não tiver entrado, ela espera um instante na sala).",
  faltou: "A call já aconteceu e a pessoa não entrou. Sem bronca nem culpa: diga que tudo bem e mande o link pra escolher outro horário.",
};

export const SISTEMA_MENSAGEM = [
  "Você escreve mensagens de WhatsApp para quem marcou uma call (videochamada) com a nossa equipe.",
  "Português do Brasil, tom informal e acolhedor, como uma pessoa real escrevendo do celular.",
  "No máximo 350 caracteres. No máximo 1 emoji.",
  "Sem markdown (nada de asterisco, negrito, lista ou título) e sem travessão.",
  "Nunca fale de preço, valor, oferta, desconto ou venda. Não use a palavra venda (nem vendas). Chame a call sempre pelo nome indicado (diagnóstico ou apresentação), nunca de call de vendas.",
  "Use só o primeiro nome da pessoa.",
  "Copie cada link pedido exatamente como veio, sem mudar nenhum caractere, sozinho na própria linha (use \\n) e sem pontuação colada nele.",
  "Não invente link, data nem horário.",
  "Se vier algo sobre a pessoa, use no máximo um toque leve disso, sem citar respostas, dados pessoais nem dizer que veio de um formulário.",
  'Responda só em JSON, no formato {"mensagem": "..."}.',
].join(" ");

/** Pedido pra IA: tipo do evento, primeiro nome, agenda, data/hora, só os links que o evento usa e, se houver, o
 *  contexto curto da ficha. Nunca WhatsApp nem e-mail. */
export function montarPromptMensagem(
  evento: NomeEvento,
  d: DadosMensagem,
  contexto: string | null,
): { sistema: string; usuario: string } {
  const links = linksObrigatorios(evento, d);
  const linhas = [
    `Situação: ${evento === "compareceu" || evento === "resumo" || evento === "comprou" ? "" : SITUACAO[evento]}`,
    `Primeiro nome: ${d.primeiroNome ? cortar(d.primeiroNome, 40) : "(não informado, não use nome)"}`,
    `Nome da call (use sempre este): ${nomeDaCall(d.agenda).nome}`,
    `Data e hora da call (Brasília): ${d.inicioTexto}`,
  ];
  if (links.includes(d.link)) linhas.push(`Link pra entrar na sala: ${d.link}`);
  if (links.includes(d.linkReagendar)) linhas.push(`Link pra escolher outro horário: ${d.linkReagendar}`);
  linhas.push(`A mensagem tem que conter, exatamente: ${links.join(" e ")}`);
  if (contexto) linhas.push(`Sobre a pessoa (só pra um toque pessoal, não cite): ${contexto}`);
  return { sistema: SISTEMA_MENSAGEM, usuario: linhas.join("\n") };
}

/** Corpo que sai pro CRM: o enfileirado, sem mudar nada, mais `campos` e `mensagem` (compatível com quem já lia o
 *  corpo antigo). */
export function corpoParaEnvio(evento: NomeEvento, corpo: Record<string, unknown>, mensagem: string): Record<string, unknown> {
  return { ...corpo, campos: montarCampos(evento, dadosDoCorpo(corpo)), mensagem };
}
