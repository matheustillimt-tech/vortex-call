import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Leitura das funções do dashboard (migração 20261023170000_dashboard.sql). Sempre com o cliente da pessoa logada
 *  (`dbUsuario`): as funções são security definer e conferem `eh_membro()` por dentro. Números do Postgres
 *  (numeric/bigint) passam por `Number` porque o PostgREST pode devolver como texto. */

export type Resumo = {
  inscritos: number;
  vieram: number;
  ficaram_ate_fim: number;
  interagiram: number;
  compraram: number;
  receita_centavos: number;
  minutos_medios: number;
  nota_media: number;
};

export type SessaoDashboard = {
  id: string;
  inicio: string;
  agenda: string;
  titulo: string | null;
  inscritos: number;
  vieram: number;
  minutos_medios: number;
  nota_media: number;
  compraram: number;
  receita_centavos: number;
  /** Nome de quem entrou primeiro como anfitrião (null = ninguém). */
  anfitriao: string | null;
};

/** Linha da tabela "Vendedores" (`dashboard_vendedores`). `vendedor_id` nulo = sessões sem anfitrião nem responsável. */
export type VendedorDashboard = {
  vendedor_id: string | null;
  nome: string | null;
  sessoes: number;
  realizadas: number;
  conduzidas: number;
  sem_anfitriao: number;
  antecedencia_media_min: number | null;
  inscritos: number;
  vieram: number;
  interagiram: number;
  nota_media: number | null;
  compraram: number;
  receita_centavos: number;
};

export type PontoRetencao = { minuto: number; presentes: number };

/** `vendedor`: filtro do admin (o membro já sai recortado pelo banco, a função ignora). */
export type ParametrosDashboard = { de: Date | null; ate: Date | null; agenda: string | null; sessao: string | null; vendedor?: string | null };

const n = (v: unknown) => Number(v ?? 0) || 0;
const nOuNulo = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

function params(p: ParametrosDashboard) {
  return { p_de: p.de?.toISOString() ?? null, p_ate: p.ate?.toISOString() ?? null, p_agenda: p.agenda, p_sessao: p.sessao, p_vendedor: p.vendedor ?? null };
}

export const RESUMO_VAZIO: Resumo = {
  inscritos: 0, vieram: 0, ficaram_ate_fim: 0, interagiram: 0, compraram: 0, receita_centavos: 0, minutos_medios: 0, nota_media: 0,
};

export async function lerResumo(db: SupabaseClient, p: ParametrosDashboard): Promise<Resumo> {
  const { data, error } = await db.rpc("dashboard_resumo", params(p));
  if (error) throw new Error(`dashboard_resumo: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!r) return RESUMO_VAZIO;
  return {
    inscritos: n(r.inscritos),
    vieram: n(r.vieram),
    ficaram_ate_fim: n(r.ficaram_ate_fim),
    interagiram: n(r.interagiram),
    compraram: n(r.compraram),
    receita_centavos: n(r.receita_centavos),
    minutos_medios: n(r.minutos_medios),
    nota_media: n(r.nota_media),
  };
}

export async function lerSessoes(db: SupabaseClient, p: ParametrosDashboard): Promise<SessaoDashboard[]> {
  const { data, error } = await db.rpc("dashboard_sessoes", params(p));
  if (error) throw new Error(`dashboard_sessoes: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    inicio: String(r.inicio),
    agenda: String(r.agenda ?? ""),
    titulo: (r.titulo as string | null) ?? null,
    inscritos: n(r.inscritos),
    vieram: n(r.vieram),
    minutos_medios: n(r.minutos_medios),
    nota_media: n(r.nota_media),
    compraram: n(r.compraram),
    receita_centavos: n(r.receita_centavos),
    anfitriao: (r.anfitriao as string | null | undefined) ?? null,
  }));
}

export async function lerVendedores(
  db: SupabaseClient,
  p: { de: Date | null; ate: Date | null; agenda: string | null; vendedor: string | null },
): Promise<VendedorDashboard[]> {
  const { data, error } = await db.rpc("dashboard_vendedores", {
    p_de: p.de?.toISOString() ?? null, p_ate: p.ate?.toISOString() ?? null, p_agenda: p.agenda, p_vendedor: p.vendedor,
  });
  if (error) throw new Error(`dashboard_vendedores: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    vendedor_id: (r.vendedor_id as string | null) ?? null,
    nome: (r.nome as string | null) ?? null,
    sessoes: n(r.sessoes),
    realizadas: n(r.realizadas),
    conduzidas: n(r.conduzidas),
    sem_anfitriao: n(r.sem_anfitriao),
    antecedencia_media_min: nOuNulo(r.antecedencia_media_min),
    inscritos: n(r.inscritos),
    vieram: n(r.vieram),
    interagiram: n(r.interagiram),
    nota_media: nOuNulo(r.nota_media),
    compraram: n(r.compraram),
    receita_centavos: n(r.receita_centavos),
  }));
}

export async function lerRetencao(db: SupabaseClient, sessao: string): Promise<PontoRetencao[]> {
  const { data, error } = await db.rpc("dashboard_retencao", { p_sessao: sessao });
  if (error) throw new Error(`dashboard_retencao: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ minuto: n(r.minuto), presentes: n(r.presentes) }));
}
