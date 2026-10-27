"use server";
import { revalidatePath } from "next/cache";
import { criarChave, revogarChave } from "@/src/lib/mcp/chaves";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { exigirAdmin } from "@/src/lib/supabase/usuario";

export type Resultado = { erro?: string; chave?: string };

/** Cria a chave em nome de quem está logado: as chamadas feitas com ela (API ou MCP) valem como dela. A chave em
 *  texto volta UMA vez, pra tela mostrar; o banco só guarda o hash. */
export async function criarChaveIntegracao(_prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const nome = String(form.get("nome") ?? "");
  const permissao = String(form.get("permissao") ?? "");
  const r = await criarChave(dbAdmin(), { nome, permissao, criadaPor: eu.id });
  if ("erro" in r) return { erro: r.erro };
  revalidatePath("/integracoes");
  return { chave: r.chave };
}

export async function revogarChaveIntegracao(id: string): Promise<{ erro?: string }> {
  await exigirAdmin();
  const r = await revogarChave(dbAdmin(), id);
  if ("erro" in r) return { erro: r.erro };
  revalidatePath("/integracoes");
  return {};
}
