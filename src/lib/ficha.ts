import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { completarJson, type CfgOpenRouter } from "./openrouter";
import {
  extrairResumo,
  linkWhatsapp,
  listaUtm,
  montarPromptResumo,
  paraSessoesAnteriores,
  respostasDoFormulario,
  rotuloOrigem,
  type ItemUtm,
  type LinhaAnterior,
  type ParResposta,
  type SessaoAnterior,
} from "./regras/ficha";
import { mascararContatosNoTexto } from "./regras/contato";
import { formatarDataHora } from "./regras/fuso";

const FUSO = "America/Sao_Paulo";

/** As rotas passam a service role (`dbAdmin()`) DEPOIS de conferir que a pessoa é da sala (agenda dela) e tem a
 *  permissão `ficha`: o cliente da equipe não lê mais o WhatsApp/e-mail/respostas do lead (migração
 *  20261024120000_permissoes.sql). Sem `contato_lead`, a rota mascara com `mascararContatoFicha` antes de responder. */
export type Db = Pick<SupabaseClient, "from">;

export type EstadoResumo = { estado: "pronto"; texto: string } | { estado: "sem_dados" } | { estado: "pendente" };

export type Ficha = {
  inscricaoId: string;
  nome: string;
  whatsapp: string;
  linkWhatsapp: string;
  email: string | null;
  origem: string;
  utm: ItemUtm[];
  inscritoEm: string;
  respostas: ParResposta[];
  anteriores: SessaoAnterior[];
  resumo: EstadoResumo;
  observacoes: string;
  /** Resumo do que foi alinhado na última call transcrita do lead (`fichas.observacoes_call`), com a data. */
  ultimaCall?: { texto: string; em: string } | null;
  /** true = WhatsApp/e-mail mascarados (sem a permissão `contato_lead`): a tela não mostra link. */
  contatoMascarado?: boolean;
  /** true = as observações têm contato do lead e quem lê não tem `contato_lead`: só leitura (ver `mascararContatoFicha`). */
  observacoesTravadas?: boolean;
};

export type ResultadoResumo = { estado: "pronto"; texto: string } | { estado: "sem_dados" } | { estado: "falhou" };

type Inscricao = {
  id: string;
  nome: string;
  whatsapp: string;
  email: string | null;
  origem: string;
  utm: unknown;
  respostas: unknown;
  created_at: string;
};

/** A inscrição, só se ela for DESTA sessão (o anfitrião de uma call não abre ficha de outra pelo id). */
async function inscricaoDaSessao(db: Db, sessaoId: string, inscricaoId: string): Promise<Inscricao | null> {
  const { data } = await db
    .from("inscricoes")
    .select("id, nome, whatsapp, email, origem, utm, respostas, created_at")
    .eq("id", inscricaoId)
    .eq("sessao_id", sessaoId)
    .maybeSingle();
  return (data as Inscricao | null) ?? null;
}

/** `soDaAgendaDe`: id do membro (não admin) — as sessões anteriores do lead ficam só nas agendas dele, como a RLS
 *  fazia quando a leitura era pelo cliente da pessoa. */
export async function lerFicha(db: Db, sessaoId: string, inscricaoId: string, soDaAgendaDe?: string): Promise<Ficha | null> {
  const i = await inscricaoDaSessao(db, sessaoId, inscricaoId);
  if (!i) return null;
  let anteriores = db
    .from("inscricoes")
    .select(soDaAgendaDe ? "status, sessoes(inicio), agendas!inner(nome)" : "status, sessoes(inicio), agendas(nome)")
    .eq("whatsapp", i.whatsapp)
    .neq("id", i.id);
  if (soDaAgendaDe) anteriores = anteriores.eq("agendas.responsavel_id", soDaAgendaDe);
  const { data: linhas } = await anteriores.order("created_at", { ascending: false }).limit(20);
  const { data: ficha } = await db.from("fichas").select("resumo_ia, observacoes, observacoes_call, observacoes_call_em").eq("whatsapp", i.whatsapp).maybeSingle();
  const salva = ficha as { resumo_ia?: string | null; observacoes?: string | null; observacoes_call?: string | null; observacoes_call_em?: string | null } | null;
  const respostas = respostasDoFormulario(i.respostas);
  const resumo: EstadoResumo = salva?.resumo_ia
    ? { estado: "pronto", texto: salva.resumo_ia }
    : respostas.length > 0
      ? { estado: "pendente" }
      : { estado: "sem_dados" };
  return {
    inscricaoId: i.id,
    nome: i.nome,
    whatsapp: i.whatsapp,
    linkWhatsapp: linkWhatsapp(i.whatsapp),
    email: i.email,
    origem: rotuloOrigem(i.origem),
    utm: listaUtm(i.utm),
    inscritoEm: formatarDataHora(new Date(i.created_at), FUSO),
    respostas,
    anteriores: paraSessoesAnteriores((linhas ?? []) as LinhaAnterior[], FUSO),
    resumo,
    observacoes: salva?.observacoes ?? "",
    ultimaCall: salva?.observacoes_call
      ? { texto: salva.observacoes_call, em: salva.observacoes_call_em ? formatarDataHora(new Date(salva.observacoes_call_em), FUSO) : "" }
      : null,
  };
}

/** Gera o resumo na primeira abertura e salva em `fichas` (por WhatsApp). Já salvo → devolve sem chamar a IA. Sem
 *  respostas → `sem_dados`. Falha da OpenRouter → `falhou` e nada é salvo (a tela oferece "Tentar de novo").
 *  Duas pessoas da equipe abrindo ao mesmo tempo podem gerar duas vezes: o último salvo vale (custo desprezível). */
export async function gerarResumo(
  db: Db,
  sessaoId: string,
  inscricaoId: string,
  ia: CfgOpenRouter,
  f: typeof fetch = fetch,
): Promise<ResultadoResumo | null> {
  const i = await inscricaoDaSessao(db, sessaoId, inscricaoId);
  if (!i) return null;
  const { data: ficha } = await db.from("fichas").select("resumo_ia").eq("whatsapp", i.whatsapp).maybeSingle();
  const salvo = (ficha as { resumo_ia?: string | null } | null)?.resumo_ia;
  if (salvo) return { estado: "pronto", texto: salvo };
  const respostas = respostasDoFormulario(i.respostas);
  if (respostas.length === 0) return { estado: "sem_dados" };
  let texto: string | null = null;
  try {
    const pedido = { ...montarPromptResumo({ nome: i.nome, respostas }), maxTokens: 400, temperatura: 0.3 };
    texto = extrairResumo(await completarJson(pedido, ia, f));
  } catch {
    texto = null;
  }
  if (!texto) return { estado: "falhou" };
  const { error } = await db
    .from("fichas")
    .upsert({ whatsapp: i.whatsapp, resumo_ia: texto, resumo_em: new Date().toISOString() }, { onConflict: "whatsapp" });
  if (error) console.error("[ficha] resumo gerado mas não salvo", i.id);
  return { estado: "pronto", texto };
}

/** `semContato`: quem salva não tem `contato_lead` — se as observações salvas têm telefone/e-mail, recusa
 *  (`travada`): ele só viu a versão mascarada e salvar por cima apagaria o contato. */
export async function salvarObservacoes(
  db: Db,
  sessaoId: string,
  inscricaoId: string,
  texto: string,
  semContato = false,
): Promise<"ok" | "nao_encontrada" | "erro" | "travada"> {
  const i = await inscricaoDaSessao(db, sessaoId, inscricaoId);
  if (!i) return "nao_encontrada";
  if (semContato) {
    const { data: atual } = await db.from("fichas").select("observacoes").eq("whatsapp", i.whatsapp).maybeSingle();
    const salvas = (atual as { observacoes?: string | null } | null)?.observacoes ?? "";
    if (mascararContatosNoTexto(salvas) !== salvas) return "travada";
  }
  const { error } = await db.from("fichas").upsert({ whatsapp: i.whatsapp, observacoes: texto }, { onConflict: "whatsapp" });
  return error ? "erro" : "ok";
}
