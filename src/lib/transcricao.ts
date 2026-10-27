import "server-only";
import type { Trecho } from "./regras/transcricao";
import { dbAdmin } from "./supabase/admin";

/** Sessão aceita falas só quando a meeting nasceu com transcrição (`rtk_transcreve`) e a call está ou esteve no ar
 *  (o último lote pode chegar logo depois de encerrar). */
export async function sessaoAceitaTrechos(sessaoId: string): Promise<boolean> {
  const { data } = await dbAdmin().from("sessoes").select("status, rtk_transcreve").eq("id", sessaoId).maybeSingle();
  return !!data && data.rtk_transcreve === true && (data.status === "ao_vivo" || data.status === "encerrada");
}

/** Grava as falas (mesma fala de novo é ignorada pelo `unique (sessao_id, rtk_id)`). */
export async function salvarTrechos(sessaoId: string, trechos: Trecho[]): Promise<void> {
  if (trechos.length === 0) return;
  const linhas = trechos.map((t) => ({
    sessao_id: sessaoId, rtk_id: t.id, falante_nome: t.nome, custom_id: t.customId, texto: t.texto, falado_em: t.em,
  }));
  const { error } = await dbAdmin().from("transcricao_trechos").upsert(linhas, { onConflict: "sessao_id,rtk_id", ignoreDuplicates: true });
  if (error) throw new Error(`Não foi possível gravar a transcrição: ${error.message}`);
}

/** Falas da sessão em ordem. `desde` (ISO) traz só as gravadas depois (a aba busca de 15 em 15 s). */
export async function listarTrechos(sessaoId: string, desde?: string): Promise<Trecho[]> {
  let q = dbAdmin()
    .from("transcricao_trechos")
    .select("rtk_id, falante_nome, custom_id, texto, falado_em, created_at")
    .eq("sessao_id", sessaoId);
  if (desde) q = q.gt("created_at", desde);
  const { data, error } = await q.order("falado_em", { ascending: true }).limit(5000);
  if (error) throw new Error(`Não foi possível ler a transcrição: ${error.message}`);
  return (data ?? []).map((l) => ({
    id: l.rtk_id as string, nome: l.falante_nome as string, customId: (l.custom_id as string | null) ?? null,
    texto: l.texto as string, em: new Date(l.falado_em as string).toISOString(),
  }));
}

/** Transcrição guardada por 90 dias (trechos do ao vivo e a da Cloudflare); o resumo (`alinhamentos`, ficha)
 *  continua. Roda no tick (barato: só apaga o que passou do prazo). Devolve quantas linhas saíram. */
export const RETENCAO_TRANSCRICAO_DIAS = 90;
export async function limparTranscricoesVelhas(agora: Date = new Date()): Promise<number> {
  const limite = new Date(agora.getTime() - RETENCAO_TRANSCRICAO_DIAS * 86_400_000).toISOString();
  const db = dbAdmin();
  const { count: trechos, error: e1 } = await db.from("transcricao_trechos").delete({ count: "exact" }).lt("created_at", limite);
  if (e1) throw new Error(`Não foi possível limpar os trechos: ${e1.message}`);
  const { count: completas, error: e2 } = await db.from("transcricoes").delete({ count: "exact" }).lt("recebida_em", limite);
  if (e2) throw new Error(`Não foi possível limpar as transcrições: ${e2.message}`);
  return (trechos ?? 0) + (completas ?? 0);
}
