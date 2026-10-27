import type { SupabaseClient } from "@supabase/supabase-js";
import { acharPorPrefixo, linkAssinado, r2Config } from "../r2";
import { prefixoNoBucket } from "../gravacao";
import { ErroRtk, linkDaGravacao } from "../realtimekit";
import { ErroApi } from "./http";

const DIA_MS = 86400_000;
/** A Cloudflare guarda a gravação por 7 dias. */
export const RETENCAO_DIAS = 7;
export const MAX_GRAVACOES = 200;

export type GravacaoApi = {
  id: string;
  origem: "sessao" | "reuniao";
  titulo: string;
  iniciada_em: string | null;
  duracao_s: number | null;
  status: string;
  /** `r2`: arquivo no bucket da empresa (não expira); `cloudflare`: storage do RealtimeKit (7 dias). */
  armazenamento: "r2" | "cloudflare";
  /** `null` quando está no R2. */
  disponivel_ate: string | null;
  expirada: boolean;
};

/** No R2 (`r2_chave`): sem prazo (`disponivel_ate` null, nunca expira). Na Cloudflare: `disponivel_ate` =
 *  (`iniciada_em` ou, sem ela, `created_at`) + 7 dias; `expirada` quando já passou. */
export function disponibilidade(
  g: { iniciada_em: string | null; created_at: string; r2_chave?: string | null },
  agora: Date = new Date(),
): { disponivel_ate: string | null; expirada: boolean } {
  if (g.r2_chave) return { disponivel_ate: null, expirada: false };
  const ate = new Date(new Date(g.iniciada_em ?? g.created_at).getTime() + RETENCAO_DIAS * DIA_MS);
  return { disponivel_ate: ate.toISOString(), expirada: agora.getTime() > ate.getTime() };
}

type Linha = {
  id: string;
  sessao_id: string | null;
  reuniao_id: string | null;
  status: string;
  duracao_s: number | null;
  iniciada_em: string | null;
  created_at: string;
  r2_chave: string | null;
  sessoes: { titulo: string | null; agendas: { nome: string } | null } | null;
  reunioes: { titulo: string } | null;
};

/** Gravações de sessões e reuniões (mais nova primeiro, até 200), pela data de criação. Padrão: últimos 7 dias. Nunca
 *  devolve o `download_url` salvo (pode ter vencido): o link sai só por `linkGravacao`. */
export async function listarGravacoes(db: SupabaseClient, f: { de?: Date | null; ate?: Date | null }, agora: Date = new Date()): Promise<GravacaoApi[]> {
  const ate = f.ate ?? agora;
  const de = f.de ?? new Date(ate.getTime() - RETENCAO_DIAS * DIA_MS);
  if (de.getTime() > ate.getTime()) throw new ErroApi(422, '"de" precisa ser antes de "ate".');
  const { data, error } = await db
    .from("gravacoes")
    .select("id, sessao_id, reuniao_id, status, duracao_s, iniciada_em, created_at, r2_chave, sessoes(titulo, agendas(nome)), reunioes(titulo)")
    .gte("created_at", de.toISOString())
    .lte("created_at", ate.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_GRAVACOES);
  if (error) throw new Error("Não deu para listar as gravações.");
  return ((data ?? []) as unknown as Linha[]).map((g) => {
    const origem = g.reuniao_id ? "reuniao" : "sessao";
    const titulo = origem === "reuniao" ? g.reunioes?.titulo : g.sessoes?.titulo ?? g.sessoes?.agendas?.nome;
    return {
      id: g.id,
      origem,
      titulo: titulo ?? "Gravação",
      iniciada_em: g.iniciada_em,
      duracao_s: g.duracao_s,
      status: g.status,
      armazenamento: g.r2_chave ? "r2" : "cloudflare",
      ...disponibilidade(g, agora),
    };
  });
}

/** O webhook pode ter chegado antes do arquivo aparecer no R2: com R2 configurado e o prefixo salvo, procura de
 *  novo agora e guarda a chave. Falha ao procurar ou ao guardar só loga (cai no link do RealtimeKit). */
async function chaveAtrasada(db: SupabaseClient, id: string, prefixo: string | null | undefined): Promise<string | null> {
  if (!prefixo || !r2Config()) return null;
  try {
    const chave = await acharPorPrefixo(prefixoNoBucket(prefixo));
    if (!chave) return null;
    const { error } = await db.from("gravacoes").update({ r2_chave: chave }).eq("id", id);
    if (error) console.error("[gravacoes] não guardou a chave do R2", id);
    return chave;
  } catch (e) {
    console.error("[gravacoes] não deu para procurar no R2", id, e instanceof Error ? e.message : "erro");
    return null;
  }
}

/** Link pra assistir/baixar. No R2 (`r2_chave`, ou achada agora pelo `r2_prefixo`): link assinado de 1 hora
 *  (`baixar` → baixa como arquivo). Senão, pedido na hora ao RealtimeKit. Inexistente → 404; expirada, sem id no
 *  RealtimeKit, apagada lá ou ainda sem arquivo → 404 "Gravação indisponível."; RealtimeKit ou R2 fora → 502. */
export async function linkGravacao(
  db: SupabaseClient,
  id: string,
  agora: Date = new Date(),
  o: { baixar?: boolean } = {},
): Promise<{ url: string; expira: string | null }> {
  const { data, error } = await db
    .from("gravacoes")
    .select("id, rtk_recording_id, iniciada_em, created_at, r2_chave, r2_prefixo")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Não deu para ler a gravação.");
  const g = data as {
    rtk_recording_id: string | null;
    iniciada_em: string | null;
    created_at: string;
    r2_chave: string | null;
    r2_prefixo?: string | null;
  } | null;
  if (!g) throw new ErroApi(404, "Gravação não encontrada.");
  const chave = g.r2_chave ?? (await chaveAtrasada(db, id, g.r2_prefixo));
  if (chave) {
    try {
      return await linkAssinado(chave, { baixar: o.baixar });
    } catch (e) {
      console.error("[gravacoes] link do R2 falhou", e instanceof Error ? e.message : "erro");
      throw new ErroApi(502, "Não deu para buscar o link agora. Tente de novo.");
    }
  }
  const indisponivel = new ErroApi(404, "Gravação indisponível.");
  if (!g.rtk_recording_id || disponibilidade(g, agora).expirada) throw indisponivel;
  try {
    const link = await linkDaGravacao(g.rtk_recording_id);
    if (!link) throw indisponivel;
    return link;
  } catch (e) {
    if (e instanceof ErroRtk) {
      if (e.status === 404) throw indisponivel;
      throw new ErroApi(502, "Não deu para buscar o link agora. Tente de novo.");
    }
    throw e;
  }
}
