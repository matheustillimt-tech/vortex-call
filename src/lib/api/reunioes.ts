import type { SupabaseClient } from "@supabase/supabase-js";
import { ErroRtk } from "../realtimekit";
import { criarReuniao } from "../reunioes";
import { ErroApi } from "./http";

const TITULO_MAX = 200;

/** `POST /api/v1/reunioes`: cria a reunião instantânea em nome de quem criou a chave. Chave sem dono (a pessoa foi
 *  apagada) → 422. Título opcional: texto de até 200 caracteres (a reunião ainda corta em 100), senão 422. `site` sem barra no fim. */
export async function criarReuniaoApi(db: SupabaseClient, usuarioId: string | null, titulo: unknown, site: string): Promise<{ codigo: string; link: string }> {
  if (titulo !== undefined && titulo !== null && typeof titulo !== "string") throw new ErroApi(422, "Título precisa ser texto.");
  if (typeof titulo === "string" && titulo.trim().length > TITULO_MAX) throw new ErroApi(422, `Título: até ${TITULO_MAX} caracteres.`);
  const semDono = new ErroApi(422, "Esta chave não tem mais um dono no time. Crie uma chave nova em Integrações.");
  if (!usuarioId) throw semDono;
  const { data, error } = await db.from("usuarios").select("id, nome").eq("id", usuarioId).maybeSingle();
  if (error) throw new Error("Não deu para ler o dono da chave.");
  if (!data) throw semDono;
  const dono = data as { id: string; nome: string };
  try {
    const { codigo } = await criarReuniao(dono, typeof titulo === "string" ? titulo : undefined);
    return { codigo, link: `${site}/r/${codigo}` };
  } catch (e) {
    if (e instanceof ErroRtk) throw new ErroApi(502, "Não conseguimos criar a sala. Tente de novo.");
    throw e;
  }
}
