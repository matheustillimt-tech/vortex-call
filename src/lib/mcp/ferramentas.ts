import "server-only";
import { listarAgendas } from "../api/agendas";
import { linkGravacao, listarGravacoes } from "../api/gravacoes";
import { ErroApi, exigirUuid, lerInstante } from "../api/http";
import { listarInscritos } from "../api/inscritos";
import { resumoDaSessao, resumoPorWhatsapp } from "../api/resumos";
import { criarReuniaoApi } from "../api/reunioes";
import { cancelarSessaoApi, criarSessaoApi, listarSessoes, sessaoApi } from "../api/sessoes";
import { siteUrl } from "../env";
import { lerFicha } from "../ficha";
import { formatarDataHora } from "../regras/fuso";
import { dbAdmin } from "../supabase/admin";
import type { ChaveAutenticada } from "./auth";

/** Ferramentas do MCP do Vórtex Call. Todas reaproveitam as funções da API REST (`src/lib/api/*`), com as mesmas
 *  regras e mensagens; a saída é um resumo em texto + `structuredContent` com os dados. Dados pessoais só saem por
 *  chave válida e nunca vão pro log. */

export type ResultadoFerramenta = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type Ferramenta = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
  /** Muda dados: exige chave com permissão `escrita`. */
  escrita: boolean;
  executar: (chave: ChaveAutenticada, args: Record<string, unknown>) => Promise<ResultadoFerramenta>;
};

export const SEM_PERMISSAO_ESCRITA = "Esta chave é só de leitura.";
const ERRO_GENERICO = "Não deu para concluir a chamada. Tente de novo.";
const FUSO = "America/Sao_Paulo";

const ok = (texto: string, dados: Record<string, unknown>): ResultadoFerramenta => ({ content: [{ type: "text", text: texto }], structuredContent: dados });
const erro = (mensagem: string): ResultadoFerramenta => ({ content: [{ type: "text", text: mensagem }], isError: true });

const SO_LEITURA = { readOnlyHint: true, openWorldHint: false } as const;
const CRIA = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const APAGA = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

const ID = (descricao: string) => ({ type: "string", format: "uuid", description: descricao });
const PERIODO_SESSOES = {
  de: { type: "string", description: 'Início do período, horário de Brasília ("AAAA-MM-DD", "AAAA-MM-DD HH:mm" ou ISO). Padrão: agora.' },
  ate: { type: "string", description: 'Fim do período, inclusive (só a data inclui o dia todo). Padrão: 14 dias depois de "de".' },
};
const PERIODO_GRAVACOES = {
  de: { type: "string", description: 'Início do período, horário de Brasília ("AAAA-MM-DD", "AAAA-MM-DD HH:mm" ou ISO). Padrão: 7 dias antes de "ate".' },
  ate: { type: "string", description: "Fim do período, inclusive (só a data inclui o dia todo). Padrão: agora." },
};

/** "2026-10-30 14:00" (com espaço, como a pessoa escreve) → "2026-10-30T14:00", que é o formato do parser da API. */
function normalizarData(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?$/.test(t) ? t.replace(" ", "T") : t;
}

/** Data opcional de filtro: ausente → `null`; inválida → erro com o nome do campo. */
function dataOpcional(args: Record<string, unknown>, nome: string, o: { fimDoDia?: boolean } = {}): Date | null {
  const v = args[nome];
  if (v === undefined || v === null || v === "") return null;
  const d = lerInstante(normalizarData(v), o);
  if (!d) throw new ErroApi(422, `Data inválida em "${nome}". Use "AAAA-MM-DD HH:mm" (Brasília) ou ISO 8601.`);
  return d;
}

const idDe = (args: Record<string, unknown>, nome: string): string => exigirUuid(typeof args[nome] === "string" ? (args[nome] as string) : "");
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const quando = (iso: string) => formatarDataHora(new Date(iso), FUSO);

export const FERRAMENTAS: Ferramenta[] = [
  {
    name: "listar_agendas",
    title: "Listar agendas",
    description: "Lista as agendas (ativas e desativadas) com endereço (slug), duração, vagas padrão e o link público de agendamento.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SO_LEITURA,
    escrita: false,
    async executar() {
      const agendas = await listarAgendas(dbAdmin(), siteUrl());
      const linhas = agendas.map((a) => `- ${a.nome} (${a.slug}), ${a.ativa ? "ativa" : "desativada"}, ${a.duracao_min} min, ${a.vagas_padrao} vagas: ${a.link_agendar}`);
      return ok([`${plural(agendas.length, "agenda", "agendas")}.`, ...linhas].join("\n"), { agendas });
    },
  },
  {
    name: "listar_sessoes",
    title: "Listar sessões",
    description: "Lista as sessões coletivas por início (até 200), com vagas, inscritos e status. Padrão: de agora até 14 dias.",
    inputSchema: {
      type: "object",
      properties: { agenda: { type: "string", description: "Endereço (slug) da agenda, como em listar_agendas." }, ...PERIODO_SESSOES },
      additionalProperties: false,
    },
    annotations: SO_LEITURA,
    escrita: false,
    async executar(_chave, args) {
      if (args.agenda !== undefined && args.agenda !== null && typeof args.agenda !== "string") throw new ErroApi(422, '"agenda" precisa ser texto.');
      const sessoes = await listarSessoes(dbAdmin(), {
        agenda: (args.agenda as string | undefined) || null,
        de: dataOpcional(args, "de"),
        ate: dataOpcional(args, "ate", { fimDoDia: true }),
      });
      const linhas = sessoes.map((s) => `- ${s.inicio_texto} | ${s.titulo ?? s.agenda ?? "Sessão"} | ${s.inscritos}/${s.vagas} inscritos | ${s.status} | id ${s.id}`);
      return ok([`${plural(sessoes.length, "sessão", "sessões")}.`, ...linhas].join("\n"), { sessoes });
    },
  },
  {
    name: "criar_sessao",
    title: "Criar sessão",
    description: "Cria uma sessão coletiva numa agenda ativa. Muda dados: confirme com o usuário antes.",
    inputSchema: {
      type: "object",
      properties: {
        agenda: { type: "string", description: "Endereço (slug) da agenda, como em listar_agendas." },
        inicio: { type: "string", description: 'Início em horário de Brasília, "AAAA-MM-DD HH:mm" (ex.: "2026-10-30 14:00"), ou ISO 8601 com fuso.' },
        vagas: { type: "integer", minimum: 1, maximum: 500, description: "Vagas (padrão: as da agenda)." },
        titulo: { type: "string", maxLength: 200, description: "Título opcional da sessão." },
      },
      required: ["agenda", "inicio"],
      additionalProperties: false,
    },
    annotations: CRIA,
    escrita: true,
    async executar(_chave, args) {
      const corpo: Record<string, unknown> = { agenda: args.agenda, inicio: normalizarData(args.inicio) };
      if (args.vagas !== undefined) corpo.vagas = args.vagas;
      if (args.titulo !== undefined) corpo.titulo = args.titulo;
      const sessao = await criarSessaoApi(dbAdmin(), corpo);
      return ok(`Sessão criada para ${sessao.inicio_texto} (${plural(sessao.vagas, "vaga", "vagas")}). Id: ${sessao.id}`, { sessao });
    },
  },
  {
    name: "cancelar_sessao",
    title: "Cancelar sessão",
    description:
      "Cancela uma sessão agendada e as inscrições dela. Sem confirmar=true só devolve o aviso com o total de inscritos e não muda nada. Confirme com o usuário antes.",
    inputSchema: {
      type: "object",
      properties: {
        sessao: ID("Id da sessão (veja listar_sessoes)."),
        confirmar: { type: "boolean", description: "true para cancelar de verdade, depois de mostrar o aviso ao usuário." },
      },
      required: ["sessao"],
      additionalProperties: false,
    },
    annotations: APAGA,
    escrita: true,
    async executar(_chave, args) {
      const id = idDe(args, "sessao");
      if (args.confirmar !== true) {
        const s = await sessaoApi(dbAdmin(), id);
        if (!s) throw new ErroApi(404, "Sessão não encontrada.");
        if (s.status !== "agendada") throw new ErroApi(409, "Só dá para cancelar sessão agendada.");
        return ok(`A sessão de ${s.inicio_texto} tem ${s.inscritos} inscritos ativos. Chame de novo com confirmar=true para cancelar.`, {
          sessao: s,
          cancelada: false,
        });
      }
      const sessao = await cancelarSessaoApi(dbAdmin(), id);
      return ok(`Sessão de ${sessao.inicio_texto} cancelada.`, { sessao, cancelada: true });
    },
  },
  {
    name: "ver_inscritos",
    title: "Ver inscritos",
    description: "Inscritos de uma sessão (todos os status), com WhatsApp, e-mail, minutos na sala, entradas e saídas e avisos enviados ao CRM.",
    inputSchema: { type: "object", properties: { sessao: ID("Id da sessão (veja listar_sessoes).") }, required: ["sessao"], additionalProperties: false },
    annotations: SO_LEITURA,
    escrita: false,
    async executar(_chave, args) {
      const inscritos = await listarInscritos(dbAdmin(), idDe(args, "sessao"));
      const linhas = inscritos.map((i) => `- ${i.nome} | ${i.status} | ${i.minutos_na_sala} min na sala | id ${i.id}`);
      return ok([`${plural(inscritos.length, "inscrito", "inscritos")}.`, ...linhas].join("\n"), { inscritos });
    },
  },
  {
    name: "ver_ficha",
    title: "Ver ficha do lead",
    description: "Ficha de um inscrito: respostas do formulário, origem, UTMs, sessões anteriores, resumo da IA e observações.",
    inputSchema: {
      type: "object",
      properties: { sessao: ID("Id da sessão."), inscricao: ID("Id da inscrição (veja ver_inscritos).") },
      required: ["sessao", "inscricao"],
      additionalProperties: false,
    },
    annotations: SO_LEITURA,
    escrita: false,
    async executar(_chave, args) {
      const ficha = await lerFicha(dbAdmin(), idDe(args, "sessao"), idDe(args, "inscricao"));
      if (!ficha) throw new ErroApi(404, "Inscrição não encontrada nesta sessão.");
      const resumo = ficha.resumo.estado === "pronto" ? "resumo pronto" : ficha.resumo.estado === "pendente" ? "resumo ainda não gerado" : "sem dados para resumo";
      return ok(
        `Ficha de ${ficha.nome}: ${plural(ficha.respostas.length, "resposta", "respostas")}, ${resumo}${ficha.observacoes ? ", com observações" : ""}.`,
        { ficha },
      );
    },
  },
  {
    name: "ver_resumo_call",
    title: "Ver resumo da call",
    description:
      "Resumo do que foi alinhado numa call transcrita (negócio, dor, combinados, escopo, orçamento e prazo, objeções, próximo passo, temperatura), pela sessão ou pelo WhatsApp do lead (a última call que ele compareceu). Com transcricao=true, traz também a transcrição em texto (até 50 mil caracteres). Base pra montar a proposta.",
    inputSchema: {
      type: "object",
      properties: {
        sessao: ID("Id da sessão (veja listar_sessoes). Use isto ou whatsapp."),
        whatsapp: { type: "string", description: "WhatsApp do lead (com DDD; sem DDI vale Brasil). Use isto ou sessao." },
        transcricao: { type: "boolean", description: "Trazer a transcrição junto. Padrão: false." },
      },
      additionalProperties: false,
    },
    annotations: SO_LEITURA,
    escrita: false,
    async executar(_chave, args) {
      const comTranscricao = args.transcricao === true;
      const r = typeof args.whatsapp === "string" && args.whatsapp.trim()
        ? await resumoPorWhatsapp(dbAdmin(), args.whatsapp, { comTranscricao })
        : await resumoDaSessao(dbAdmin(), idDe(args, "sessao"), { comTranscricao });
      const ESTADO: Record<string, string> = {
        sem_transcricao: "Essa sessão não foi transcrita (a agenda estava sem \"Transcrever e resumir a call\").",
        aguardando: "A call ainda não acabou ou o resumo ainda não entrou na fila.",
        pendente: "O resumo está na fila: sai em alguns minutos.",
        sem_fala: "A call teve menos de 3 minutos de conversa: não deu resumo.",
        falhou: "O resumo automático falhou; veja a transcrição (transcricao=true).",
      };
      const linhas = [`Call de ${r.sessao.inicio_texto}${"lead" in r ? ` com ${(r as { lead: string }).lead}` : ""}.`];
      linhas.push(r.resumo ? r.resumo.texto : (ESTADO[r.estado] ?? `Resumo: ${r.estado}.`));
      if (r.transcricao) linhas.push("", "Transcrição:", r.transcricao, r.transcricao_cortada ? "[… cortada em 50 mil caracteres]" : "");
      return ok(linhas.join("\n").trim(), r as unknown as Record<string, unknown>);
    },
  },
  {
    name: "listar_gravacoes",
    title: "Listar gravações",
    description: 'Gravações de sessões e reuniões (mais nova primeiro, até 200). Padrão: últimos 7 dias. Guardadas no R2 da empresa não expiram; as que ficaram na Cloudflare duram 7 dias. O link sai por link_gravacao.',
    inputSchema: { type: "object", properties: { ...PERIODO_GRAVACOES }, additionalProperties: false },
    annotations: SO_LEITURA,
    escrita: false,
    async executar(_chave, args) {
      const gravacoes = await listarGravacoes(dbAdmin(), { de: dataOpcional(args, "de"), ate: dataOpcional(args, "ate", { fimDoDia: true }) });
      const linhas = gravacoes.map(
        (g) => `- ${g.titulo} (${g.origem === "reuniao" ? "reunião" : "sessão"}) | ${g.armazenamento === "r2" ? "Guardada no R2" : g.expirada || !g.disponivel_ate ? "Expirada" : `Disponível até ${quando(g.disponivel_ate)}`} | id ${g.id}`,
      );
      return ok([`${plural(gravacoes.length, "gravação", "gravações")}.`, ...linhas].join("\n"), { gravacoes });
    },
  },
  {
    name: "link_gravacao",
    title: "Link da gravação",
    description: "Link de download de uma gravação, pedido na hora (o link vence; peça de novo quando precisar).",
    inputSchema: { type: "object", properties: { gravacao: ID("Id da gravação (veja listar_gravacoes).") }, required: ["gravacao"], additionalProperties: false },
    annotations: SO_LEITURA,
    escrita: false,
    async executar(_chave, args) {
      const link = await linkGravacao(dbAdmin(), idDe(args, "gravacao"));
      return ok(`Link da gravação${link.expira ? ` (vale até ${quando(link.expira)})` : ""}: ${link.url}`, link);
    },
  },
  {
    name: "criar_reuniao",
    title: "Criar reunião",
    description: "Cria uma reunião instantânea em nome de quem criou a chave e devolve o link. Muda dados: confirme com o usuário antes.",
    inputSchema: { type: "object", properties: { titulo: { type: "string", maxLength: 200, description: "Título opcional." } }, additionalProperties: false },
    annotations: CRIA,
    escrita: true,
    async executar(chave, args) {
      const reuniao = await criarReuniaoApi(dbAdmin(), chave.usuarioId, args.titulo, siteUrl());
      return ok(`Reunião criada: ${reuniao.link}`, reuniao);
    },
  },
];

/** Lista pública de `tools/list` (sem os campos internos). */
export function listaDeFerramentas() {
  return FERRAMENTAS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
}

export function acharFerramenta(nome: string): Ferramenta | undefined {
  return FERRAMENTAS.find((f) => f.name === nome);
}

/** Roda a ferramenta conferindo a permissão. Erro de negócio (`ErroApi`) vira `isError` com a mensagem dele; qualquer
 *  outro, `isError` genérico (no log só a mensagem, nunca dados de lead). */
export async function chamarFerramenta(f: Ferramenta, chave: ChaveAutenticada, args: Record<string, unknown>): Promise<ResultadoFerramenta> {
  if (f.escrita && chave.permissao !== "escrita") return erro(SEM_PERMISSAO_ESCRITA);
  try {
    return await f.executar(chave, args);
  } catch (e) {
    if (e instanceof ErroApi) return erro(e.message);
    console.error(`[mcp] ${f.name}`, e instanceof Error ? e.message : "erro");
    return erro(ERRO_GENERICO);
  }
}
