import "server-only";
import { filtrarJanela } from "./regras/janela";
import { montarVitrine, type ItemVitrine, type SessaoVitrine } from "./regras/vitrine";
import { dbAdmin } from "./supabase/admin";

export type AgendaPublica = { slug: string; titulo_publico: string; descricao: string; duracao_min: number };

/** Agenda e horários que o lead vê (página `/agendar/{slug}`, módulo encaixado e o "Escolher outro horário" do link
 *  pessoal), já cortados pela janela de agendamento da agenda (`janela_dias`). */
export async function carregarAgendaPublica(slug: string): Promise<null | { agenda: AgendaPublica; sessoes: ItemVitrine[] }> {
  const db = dbAdmin();
  const { data: linha } = await db.from("agendas").select("slug, titulo_publico, descricao, duracao_min, janela_dias").eq("slug", slug).eq("ativa", true).maybeSingle();
  if (!linha) return null;
  const { janela_dias, ...agenda } = linha as AgendaPublica & { janela_dias?: number | null };
  const { data, error } = await db.rpc("vitrine_agenda", { p_slug: slug });
  if (error) throw error;
  const agora = new Date();
  const sessoes = filtrarJanela((data ?? []) as SessaoVitrine[], janela_dias ?? null, agora);
  return { agenda, sessoes: montarVitrine(sessoes, agora, agenda.duracao_min) };
}
