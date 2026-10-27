import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Chaves de acesso da API (`/api/v1/*`) e do MCP (`POST /api/mcp`). Formato `vc_` + 40 caracteres base62. O
 *  banco guarda só o `prefixo` (8 primeiros caracteres depois de `vc_`) e o `hash` (SHA-256 hex da chave inteira);
 *  a chave em texto aparece uma vez, na criação. Nunca logar a chave. */

export const PERMISSOES = ["leitura", "escrita"] as const;
export type Permissao = (typeof PERMISSOES)[number];

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TAMANHO = 40;
export const FORMATO_CHAVE = /^vc_[0-9A-Za-z]{40}$/;

/** `vc_` + 40 caracteres base62, sem viés (descarta bytes ≥ 248, o maior múltiplo de 62 abaixo de 256). */
export function gerarChave(): string {
  let saida = "";
  while (saida.length < TAMANHO) {
    for (const b of randomBytes(TAMANHO * 2)) {
      if (b >= 248) continue;
      saida += BASE62[b % 62];
      if (saida.length === TAMANHO) break;
    }
  }
  return `vc_${saida}`;
}

export function hashDaChave(chave: string): string {
  return createHash("sha256").update(chave, "utf8").digest("hex");
}

export function prefixoDaChave(chave: string): string {
  return chave.slice(3, 11);
}

export function ehPermissao(v: unknown): v is Permissao {
  return typeof v === "string" && (PERMISSOES as readonly string[]).includes(v);
}

type Db = Pick<SupabaseClient, "from">;

/** Cria a chave (service role; quem chama confere que é admin). Devolve a chave em texto (mostrar UMA vez). */
export async function criarChave(db: Db, e: { nome: string; permissao: string; criadaPor: string }): Promise<{ chave: string; id: string } | { erro: string }> {
  const nome = typeof e.nome === "string" ? e.nome.trim() : "";
  if (nome.length < 1 || nome.length > 60) return { erro: "Nome da chave: de 1 a 60 caracteres." };
  if (!ehPermissao(e.permissao)) return { erro: "Permissão inválida." };
  const chave = gerarChave();
  const { data, error } = await db
    .from("chaves_api")
    .insert({ nome, permissao: e.permissao, prefixo: prefixoDaChave(chave), hash: hashDaChave(chave), criada_por: e.criadaPor })
    .select("id")
    .single();
  if (error || !data) return { erro: "Não deu para criar a chave." };
  return { chave, id: (data as { id: string }).id };
}

/** Revoga (marca `revogada_em`; não apaga, pra lista mostrar). */
export async function revogarChave(db: Db, id: string): Promise<{ ok: true } | { erro: string }> {
  const { data, error } = await db.from("chaves_api").update({ revogada_em: new Date().toISOString() }).eq("id", id).is("revogada_em", null).select("id");
  if (error) return { erro: "Não deu para revogar a chave." };
  if (!(data as unknown[] | null)?.length) return { erro: "Chave não encontrada ou já revogada." };
  return { ok: true };
}
