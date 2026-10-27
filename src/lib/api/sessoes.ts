import type { SupabaseClient } from "@supabase/supabase-js";
import { formatarSessao } from "../regras/fuso";
import { ErroApi, lerInstante } from "./http";

const FUSO = "America/Sao_Paulo";
const DIA_MS = 86400_000;
export const JANELA_SESSOES_DIAS = 14;
export const MAX_SESSOES = 200;
const TITULO_MAX = 200;

export type SessaoApi = {
  id: string;
  agenda: string | null;
  titulo: string | null;
  inicio: string;
  inicio_texto: string;
  vagas: number;
  inscritos: number;
  status: string;
  /** Nome de quem entrou primeiro como anfitrião (null = ninguém ainda). */
  anfitriao: string | null;
};

/** Inscritos = inscrições que não foram canceladas (agendado, compareceu, faltou). */
const COLUNAS = "id, titulo, inicio, vagas, status, agendas(slug), inscricoes(count), anfitriao:usuarios!sessoes_anfitriao_id_fkey(nome)";
type Linha = {
  id: string; titulo: string | null; inicio: string; vagas: number; status: string; agendas: { slug: string } | null; inscricoes: { count: number }[];
  anfitriao: { nome: string } | null;
};

function formatar(s: Linha): SessaoApi {
  const inicio = new Date(s.inicio);
  return {
    id: s.id,
    agenda: s.agendas?.slug ?? null,
    titulo: s.titulo,
    inicio: inicio.toISOString(),
    inicio_texto: formatarSessao(inicio, FUSO),
    vagas: s.vagas,
    inscritos: s.inscricoes?.[0]?.count ?? 0,
    status: s.status,
    anfitriao: s.anfitriao?.nome ?? null,
  };
}

/** Uma sessão no formato da API, ou `null` se não existe. */
export async function sessaoApi(db: SupabaseClient, id: string): Promise<SessaoApi | null> {
  const { data, error } = await db.from("sessoes").select(COLUNAS).neq("inscricoes.status", "cancelado").eq("id", id).maybeSingle();
  if (error) throw new Error("Não deu para ler a sessão.");
  return data ? formatar(data as unknown as Linha) : null;
}

/** Sessões por início (até 200). Padrão: de agora até 14 dias. `agenda` é o slug (inexistente → 404). */
export async function listarSessoes(
  db: SupabaseClient,
  f: { agenda?: string | null; de?: Date | null; ate?: Date | null },
  agora: Date = new Date(),
): Promise<SessaoApi[]> {
  const de = f.de ?? agora;
  const ate = f.ate ?? new Date(de.getTime() + JANELA_SESSOES_DIAS * DIA_MS);
  if (de.getTime() > ate.getTime()) throw new ErroApi(422, '"de" precisa ser antes de "ate".');
  let q = db.from("sessoes").select(COLUNAS).neq("inscricoes.status", "cancelado").gte("inicio", de.toISOString()).lte("inicio", ate.toISOString());
  if (f.agenda) {
    const { data: agenda, error } = await db.from("agendas").select("id").eq("slug", f.agenda).maybeSingle();
    if (error) throw new Error("Não deu para ler a agenda.");
    if (!agenda) throw new ErroApi(404, "Agenda não encontrada.");
    q = q.eq("agenda_id", (agenda as { id: string }).id);
  }
  const { data, error } = await q.order("inicio").limit(MAX_SESSOES);
  if (error) throw new Error("Não deu para listar as sessões.");
  return ((data ?? []) as unknown as Linha[]).map(formatar);
}

export type NovaSessao = { agenda_id: string; inicio: Date | null; vagas: number; titulo: string | null };
export type ResultadoCriar = { id: string } | { erro: string; tipo: "validacao" | "banco" };

/** Regra única de criar sessão (painel e API): agenda escolhida, ativa e existente, início no futuro, vagas inteiras
 *  de 1 a 500, título opcional de até 200 caracteres. `db` vem de quem chama (painel: sessão do admin; API: admin). */
export async function criarSessao(db: SupabaseClient, n: NovaSessao, agora: Date = new Date()): Promise<ResultadoCriar> {
  const invalido = (erro: string): ResultadoCriar => ({ erro, tipo: "validacao" });
  if (!n.agenda_id) return invalido("Escolha a agenda.");
  if (!n.inicio || n.inicio.getTime() <= agora.getTime()) return invalido("Escolha uma data e hora no futuro.");
  if (!(Number.isInteger(n.vagas) && n.vagas >= 1 && n.vagas <= 500)) return invalido("Vagas: de 1 a 500.");
  if (n.titulo && n.titulo.length > TITULO_MAX) return invalido(`Título: até ${TITULO_MAX} caracteres.`);
  const { data: agenda, error: erroAgenda } = await db.from("agendas").select("id, ativa").eq("id", n.agenda_id).maybeSingle();
  if (erroAgenda) return { erro: "Não deu para criar a sessão.", tipo: "banco" };
  if (!agenda || !(agenda as { ativa: boolean }).ativa) return invalido("Essa agenda não existe ou está desativada.");
  const { data, error } = await db
    .from("sessoes")
    .insert({ agenda_id: n.agenda_id, inicio: n.inicio.toISOString(), vagas: n.vagas, titulo: n.titulo })
    .select("id")
    .single();
  if (error || !data) return { erro: "Não deu para criar a sessão.", tipo: "banco" };
  return { id: (data as { id: string }).id };
}

/** `POST /api/v1/sessoes`: `{ agenda: slug, inicio, vagas?, titulo? }`. Vagas padrão = da agenda. */
export async function criarSessaoApi(db: SupabaseClient, corpo: Record<string, unknown>, agora: Date = new Date()): Promise<SessaoApi> {
  if (typeof corpo.agenda !== "string" || !corpo.agenda) throw new ErroApi(422, 'Informe "agenda" (o endereço da agenda, como em GET /api/v1/agendas).');
  if (corpo.vagas !== undefined && typeof corpo.vagas !== "number") throw new ErroApi(422, "Vagas: de 1 a 500.");
  if (corpo.titulo !== undefined && corpo.titulo !== null && typeof corpo.titulo !== "string") throw new ErroApi(422, "Título precisa ser texto.");
  const { data: agenda, error } = await db.from("agendas").select("id, ativa, vagas_padrao").eq("slug", corpo.agenda).maybeSingle();
  if (error) throw new Error("Não deu para ler a agenda.");
  const a = agenda as { id: string; ativa: boolean; vagas_padrao: number } | null;
  if (!a || !a.ativa) throw new ErroApi(422, "Essa agenda não existe ou está desativada.");
  const r = await criarSessao(
    db,
    {
      agenda_id: a.id,
      inicio: lerInstante(corpo.inicio),
      vagas: corpo.vagas === undefined ? a.vagas_padrao : (corpo.vagas as number),
      titulo: typeof corpo.titulo === "string" ? corpo.titulo.trim() || null : null,
    },
    agora,
  );
  if ("erro" in r) {
    if (r.tipo === "validacao") throw new ErroApi(422, r.erro);
    throw new Error(r.erro);
  }
  const s = await sessaoApi(db, r.id);
  if (!s) throw new Error("Sessão criada e não encontrada.");
  return s;
}

/** Regra única de cancelar (painel e API): só sessão `agendada` vira `cancelada`; as inscrições `agendado` dela viram
 *  `cancelado` (libera a pessoa pra agendar de novo: senão a inscrição velha bate no índice único
 *  `inscricoes_uma_ativa_por_agenda`). Erro de banco → lança "Não deu para cancelar.". */
export async function cancelarSessao(db: SupabaseClient, id: string): Promise<"ok" | "nao_encontrada" | "nao_agendada"> {
  const { data, error } = await db.from("sessoes").update({ status: "cancelada" }).eq("id", id).eq("status", "agendada").select("id");
  if (error) throw new Error("Não deu para cancelar.");
  if (!data?.length) {
    const { data: existe, error: erroLer } = await db.from("sessoes").select("id").eq("id", id).maybeSingle();
    if (erroLer) throw new Error("Não deu para cancelar.");
    return existe ? "nao_agendada" : "nao_encontrada";
  }
  const { error: erroInscricoes } = await db.from("inscricoes").update({ status: "cancelado" }).eq("sessao_id", id).eq("status", "agendado");
  if (erroInscricoes) throw new Error("Não deu para cancelar.");
  return "ok";
}

/** `POST /api/v1/sessoes/{id}/cancelar`: inexistente → 404; já ao vivo/encerrada/cancelada → 409. */
export async function cancelarSessaoApi(db: SupabaseClient, id: string): Promise<SessaoApi> {
  const r = await cancelarSessao(db, id);
  if (r === "nao_encontrada") throw new ErroApi(404, "Sessão não encontrada.");
  if (r === "nao_agendada") throw new ErroApi(409, "Só dá para cancelar sessão agendada.");
  const s = await sessaoApi(db, id);
  if (!s) throw new ErroApi(404, "Sessão não encontrada.");
  return s;
}
