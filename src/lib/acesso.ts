import "server-only";
import { notFound } from "next/navigation";
import { podeVerAgenda, type Quem } from "./regras/acesso";
import { pode } from "./regras/permissoes";
import { dbAdmin } from "./supabase/admin";
import { exigirMembro, type Membro } from "./supabase/usuario";

/** Recorte por agenda nas rotas e páginas que usam a service role (`dbAdmin` ignora a RLS): depois de saber QUEM
 *  é (membro ativo), confere se essa pessoa vê a sessão/gravação. Sem acesso é tratado igual a "não existe" (404),
 *  pra não confirmar que o id existe. Admin passa sem consultar (quem chama trata o "não existe" de verdade). */

function primeiro<T>(v: T | T[] | null | undefined): T | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

/** A pessoa vê esta sessão? (agenda dela, ou é admin). Sessão inexistente = false. */
export async function podeVerSessao(quem: Quem, sessaoId: string): Promise<boolean> {
  if (quem.papel === "admin") return true;
  const { data } = await dbAdmin().from("sessoes").select("agenda_id, agendas(responsavel_id)").eq("id", sessaoId).maybeSingle();
  if (!data) return false;
  const agenda = primeiro(data.agendas as { responsavel_id: string | null } | { responsavel_id: string | null }[] | null);
  return podeVerAgenda(quem, agenda?.responsavel_id);
}

/** Leitura (só ver): a sessão é de agenda dele, OU ele tem `todas_agendas` (vê sessões, inscritos e números de todas
 *  as agendas, sem mexer). Mesma regra da função SQL `pode_ler_sessao`. Gestão (sala, ficha, horários, gravações)
 *  continua em `podeVerSessao`. Sessão inexistente = false. */
export async function podeLerSessao(quem: Quem, sessaoId: string): Promise<boolean> {
  if (quem.papel === "admin") return true;
  if (!pode(quem, "todas_agendas")) return podeVerSessao(quem, sessaoId);
  const { data } = await dbAdmin().from("sessoes").select("id").eq("id", sessaoId).maybeSingle();
  return !!data;
}

/** Gravação de sessão segue a agenda da sessão; de reunião instantânea, toda a equipe (como antes). Sem a permissão
 *  `gravacoes`, nenhuma. Inexistente = false. */
export async function podeVerGravacao(quem: Quem, gravacaoId: string): Promise<boolean> {
  if (quem.papel === "admin") return true;
  if (!pode(quem, "gravacoes")) return false;
  const { data } = await dbAdmin()
    .from("gravacoes")
    .select("sessao_id, reuniao_id, sessoes(agenda_id, agendas(responsavel_id))")
    .eq("id", gravacaoId)
    .maybeSingle();
  if (!data) return false;
  if (!data.sessao_id) return true;
  const sessao = primeiro(data.sessoes as unknown as { agendas: unknown } | null);
  const agenda = primeiro(sessao?.agendas as { responsavel_id: string | null } | null);
  return podeVerAgenda(quem, agenda?.responsavel_id);
}

/** Membro (não admin) sem nenhuma agenda dele: as listas do painel mostram o estado vazio próprio. `db` é o cliente da
 *  pessoa logada (a RLS só devolve as agendas dela). */
export async function membroSemAgenda(quem: Quem, db: { from: ReturnType<typeof dbAdmin>["from"] }): Promise<boolean> {
  if (quem.papel === "admin") return false;
  const { data } = await db.from("agendas").select("id").limit(1);
  return (data ?? []).length === 0;
}

/** Páginas da equipe que mostram uma sessão (só ver): membro ativo E dono da agenda, ou com `todas_agendas` (ou
 *  admin); senão 404. Pra saber se pode mexer (sala, horários), a página confere `podeVerSessao`. */
export async function exigirAcessoSessao(sessaoId: string): Promise<Membro> {
  const eu = await exigirMembro();
  if (!(await podeLerSessao(eu, sessaoId))) notFound();
  return eu;
}

/** Horários (sessão avulsa, repetição, vagas, cancelar sessão vazia): pode o admin ou o responsável pela agenda. As
 *  ações do painel conferem com estas funções e só então gravam pela service role. */
export const SO_GESTOR = "Só o admin ou o responsável pela agenda pode fazer isso.";

/** Quem está logado, se pode mexer nos horários desta agenda; senão `null`. Admin passa sem consultar. */
export async function gestorDaAgenda(agendaId: string): Promise<Membro | null> {
  const eu = await exigirMembro();
  if (eu.papel === "admin") return eu;
  const { data } = await dbAdmin().from("agendas").select("responsavel_id").eq("id", agendaId).maybeSingle();
  return data && podeVerAgenda(eu, data.responsavel_id as string | null) ? eu : null;
}

/** Mesma regra pela sessão (a agenda vem da sessão): é a regra de `podeVerSessao`. */
export async function gestorDaSessao(sessaoId: string): Promise<Membro | null> {
  const eu = await exigirMembro();
  return (await podeVerSessao(eu, sessaoId)) ? eu : null;
}

/** Mesma regra pela repetição (a agenda vem da repetição). Repetição inexistente = `null` (admin passa). */
export async function gestorDaRepeticao(repeticaoId: string): Promise<Membro | null> {
  const eu = await exigirMembro();
  if (eu.papel === "admin") return eu;
  const { data } = await dbAdmin().from("repeticoes").select("agenda_id").eq("id", repeticaoId).maybeSingle();
  return data ? gestorDaAgenda(data.agenda_id as string) : null;
}
