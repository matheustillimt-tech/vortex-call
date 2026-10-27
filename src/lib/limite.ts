import "server-only";
import { dbAdmin } from "./supabase/admin";

/** Janela de 1 minuto por chave (ex.: `inscrever:<hash do ip>`). Conta de forma atômica (RPC `contar_limite`,
 *  insert-ou-soma-1 num único comando) e diz se ainda está dentro do máximo.
 *  Falha do banco não bloqueia o lead (devolve true). */
export async function dentroDoLimite(chave: string, maximo: number, agora = new Date()): Promise<boolean> {
  const janela = new Date(Math.floor(agora.getTime() / 60_000) * 60_000).toISOString();
  const db = dbAdmin();
  const { data: total, error } = await db.rpc("contar_limite", { p_chave: chave, p_janela: janela });
  if (error) return true;
  return (total ?? 0) <= maximo;
}

/** Apaga as janelas de `limites` com mais de 1 hora, pra tabela não crescer pra sempre.
 *  Falha do banco não quebra o cron (devolve 0). */
export async function limparLimites(agora = new Date()): Promise<number> {
  const corte = new Date(agora.getTime() - 60 * 60_000).toISOString();
  const db = dbAdmin();
  const { error, count } = await db.from("limites").delete({ count: "exact" }).lt("janela", corte);
  if (error) return 0;
  return count ?? 0;
}
