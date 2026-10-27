import type { SupabaseClient } from "@supabase/supabase-js";
import { fecharMeeting } from "../participantes";
import { apagar } from "../r2";

/** Tipo aceito por `contar_dependencias` (SQL, Task 1): o mesmo nome usado nas rotas e nos testes. */
export type TipoExclusao = "agenda" | "sessao" | "reuniao" | "gravacao";

export type Dependencias = { sessoes: number; inscritos: number; gravacoes: number; avisos: number; vendas: number };

/** O que está ligado a uma agenda/sessão/reunião/gravação, pro modal de exclusão mostrar antes de apagar.
 *  `contar_dependencias` já confere `eh_membro()` no banco (ver migração do dashboard). */
export async function contarDependencias(db: SupabaseClient, tipo: TipoExclusao, id: string): Promise<Dependencias> {
  const { data, error } = await db.rpc("contar_dependencias", { p_tipo: tipo, p_id: id });
  if (error) throw new Error("Não deu para contar o que está ligado.");
  return data as Dependencias;
}

/** Nada ligado: o modal de excluir gravação não mostra contagem nenhuma (a própria gravação não é dependência). */
export const SEM_DEPENDENCIAS: Dependencias = { sessoes: 0, inscritos: 0, gravacoes: 0, avisos: 0, vendas: 0 };

/** Contagens de várias reuniões de uma vez (lista de Reuniões): numa reunião só a gravação vai junto, então uma
 *  consulta em `gravacoes` substitui um `contar_dependencias` por linha. Mesma regra do SQL pro tipo `reuniao`. */
export async function dependenciasDasReunioes(db: SupabaseClient, ids: string[]): Promise<Map<string, Dependencias>> {
  const r = new Map<string, Dependencias>();
  if (!ids.length) return r;
  const { data, error } = await db.from("gravacoes").select("reuniao_id").in("reuniao_id", ids);
  if (error) throw new Error("Não deu para contar o que está ligado.");
  for (const id of ids) r.set(id, { ...SEM_DEPENDENCIAS });
  for (const g of (data ?? []) as { reuniao_id: string }[]) {
    const c = r.get(g.reuniao_id);
    if (c) c.gravacoes++;
  }
  return r;
}

/** Tira todo mundo da sala e desativa a meeting; nunca impede a exclusão (loga e segue), como o fechamento de
 *  sessões/reuniões vencidas (`src/lib/sala.ts`, `src/lib/reunioes.ts`). */
async function desligarSala(meetingId: string): Promise<void> {
  try {
    await fecharMeeting(meetingId);
  } catch (e) {
    console.error("[excluir] falha ao desligar a sala", meetingId, e instanceof Error ? e.message : e);
  }
}

/** Apaga o arquivo no R2; falha (ou R2 não configurado) é só logada — nunca impede apagar o registro. */
async function apagarNoR2(chave: string): Promise<void> {
  try {
    await apagar(chave);
  } catch (e) {
    console.error("[excluir] falha ao apagar do R2", chave, e instanceof Error ? e.message : e);
  }
}

async function apagarChavesR2(chaves: string[]): Promise<void> {
  for (const chave of chaves) await apagarNoR2(chave);
}

type LinhaGravacao = { r2_chave: string | null };

async function chavesR2Por(db: SupabaseClient, coluna: "sessao_id" | "reuniao_id", valor: string): Promise<string[]> {
  const { data, error } = await db.from("gravacoes").select("r2_chave").eq(coluna, valor);
  if (error) throw new Error("Não deu para ler as gravações.");
  return ((data ?? []) as LinhaGravacao[]).map((g) => g.r2_chave).filter((c): c is string => !!c);
}

async function chavesR2PorSessoes(db: SupabaseClient, sessaoIds: string[]): Promise<string[]> {
  if (!sessaoIds.length) return [];
  const { data, error } = await db.from("gravacoes").select("r2_chave").in("sessao_id", sessaoIds);
  if (error) throw new Error("Não deu para ler as gravações.");
  return ((data ?? []) as LinhaGravacao[]).map((g) => g.r2_chave).filter((c): c is string => !!c);
}

/** Apaga os passes RTK da meeting (sem FK pra sessão/reunião): falha só é logada. */
async function apagarPasses(db: SupabaseClient, meetingId: string): Promise<void> {
  const { error } = await db.from("passes_rtk").delete().eq("meeting_id", meetingId);
  if (error) console.error("[excluir] falha ao limpar passes_rtk", meetingId, error.message);
}

/** Apaga a gravação: lê a `r2_chave` antes, apaga a linha, só então apaga o arquivo no R2 (falha logada, não
 *  impede). Gravação inexistente: nada a fazer. */
export async function excluirGravacao(db: SupabaseClient, id: string): Promise<void> {
  const { data, error: erroLer } = await db.from("gravacoes").select("r2_chave").eq("id", id).maybeSingle();
  if (erroLer) throw new Error("Não deu para excluir a gravação.");
  const r2Chave = (data as LinhaGravacao | null)?.r2_chave ?? null;
  const { error } = await db.from("gravacoes").delete().eq("id", id);
  if (error) throw new Error("Não deu para excluir a gravação.");
  if (r2Chave) await apagarNoR2(r2Chave);
}

/** Apaga a sessão (cascata no banco: inscrições, presenças, eventos, atividade do lead, gravações da sessão).
 *  Ordem: sessão `ao_vivo` com meeting → desliga a sala; lê as `r2_chave` das gravações da sessão ANTES do delete
 *  (a cascata apaga as linhas); apaga a sessão; limpa `passes_rtk` da meeting; só então apaga os arquivos no R2.
 *  Sessão inexistente: nada a fazer. */
export async function excluirSessao(db: SupabaseClient, id: string): Promise<void> {
  const { data, error: erroLer } = await db.from("sessoes").select("status, rtk_meeting_id").eq("id", id).maybeSingle();
  if (erroLer) throw new Error("Não deu para excluir a sessão.");
  const sessao = data as { status: string; rtk_meeting_id: string | null } | null;
  if (!sessao) return;
  if (sessao.status === "ao_vivo" && sessao.rtk_meeting_id) await desligarSala(sessao.rtk_meeting_id);
  const chaves = await chavesR2Por(db, "sessao_id", id);
  const { error } = await db.from("sessoes").delete().eq("id", id);
  if (error) throw new Error("Não deu para excluir a sessão.");
  if (sessao.rtk_meeting_id) await apagarPasses(db, sessao.rtk_meeting_id);
  await apagarChavesR2(chaves);
}

/** Apaga a reunião instantânea (cascata: gravações da reunião). Reunião ainda não encerrada (`encerrada_em` null,
 *  vencida ou não) com meeting → desliga a sala primeiro. Mesma ordem de `excluirSessao`. Reunião inexistente:
 *  nada a fazer. */
export async function excluirReuniao(db: SupabaseClient, id: string): Promise<void> {
  const { data, error: erroLer } = await db.from("reunioes").select("encerrada_em, rtk_meeting_id").eq("id", id).maybeSingle();
  if (erroLer) throw new Error("Não deu para excluir a reunião.");
  const reuniao = data as { encerrada_em: string | null; rtk_meeting_id: string | null } | null;
  if (!reuniao) return;
  if (!reuniao.encerrada_em && reuniao.rtk_meeting_id) await desligarSala(reuniao.rtk_meeting_id);
  const chaves = await chavesR2Por(db, "reuniao_id", id);
  const { error } = await db.from("reunioes").delete().eq("id", id);
  if (error) throw new Error("Não deu para excluir a reunião.");
  if (reuniao.rtk_meeting_id) await apagarPasses(db, reuniao.rtk_meeting_id);
  await apagarChavesR2(chaves);
}

/** Apaga a agenda (cascata: sessões → inscrições/presenças/eventos/atividade do lead; gravações das sessões).
 *  Toda sessão `ao_vivo` com meeting é desligada antes; as `r2_chave` de todas as gravações das sessões são lidas
 *  antes do delete; depois de apagar, limpa `passes_rtk` de cada meeting e só então os arquivos no R2. Agenda
 *  inexistente: nada a fazer (o `delete` simplesmente não acha linha). */
export async function excluirAgenda(db: SupabaseClient, id: string): Promise<void> {
  const { data, error: erroLer } = await db.from("sessoes").select("id, status, rtk_meeting_id").eq("agenda_id", id);
  if (erroLer) throw new Error("Não deu para excluir a agenda.");
  const sessoes = (data ?? []) as { id: string; status: string; rtk_meeting_id: string | null }[];
  for (const s of sessoes) {
    if (s.status === "ao_vivo" && s.rtk_meeting_id) await desligarSala(s.rtk_meeting_id);
  }
  const chaves = await chavesR2PorSessoes(db, sessoes.map((s) => s.id));
  const { error } = await db.from("agendas").delete().eq("id", id);
  if (error) throw new Error("Não deu para excluir a agenda.");
  for (const s of sessoes) {
    if (s.rtk_meeting_id) await apagarPasses(db, s.rtk_meeting_id);
  }
  await apagarChavesR2(chaves);
}
