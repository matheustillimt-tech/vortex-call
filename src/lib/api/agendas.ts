import type { SupabaseClient } from "@supabase/supabase-js";

export type AgendaApi = {
  id: string;
  nome: string;
  slug: string;
  ativa: boolean;
  duracao_min: number;
  vagas_padrao: number;
  /** Nome do vendedor responsável (null = sem responsável). */
  responsavel: string | null;
  link_agendar: string;
};

type Linha = Omit<AgendaApi, "link_agendar" | "responsavel"> & { responsavel: { nome: string } | { nome: string }[] | null };

/** Todas as agendas (ativas e desativadas), por nome, com o responsável e o link público de agendamento. `site` sem
 *  barra no fim. */
export async function listarAgendas(db: SupabaseClient, site: string): Promise<AgendaApi[]> {
  const { data, error } = await db
    .from("agendas")
    .select("id, nome, slug, ativa, duracao_min, vagas_padrao, responsavel:usuarios!agendas_responsavel_id_fkey(nome)")
    .order("nome");
  if (error) throw new Error("Não deu para listar as agendas.");
  return ((data ?? []) as unknown as Linha[]).map((a) => {
    const r = Array.isArray(a.responsavel) ? a.responsavel[0] : a.responsavel;
    return {
      id: a.id, nome: a.nome, slug: a.slug, ativa: a.ativa, duracao_min: a.duracao_min, vagas_padrao: a.vagas_padrao,
      responsavel: r?.nome ?? null,
      link_agendar: `${site}/agendar/${a.slug}`,
    };
  });
}
