"use server";
import { revalidatePath } from "next/cache";
import { excluirGravacao } from "@/src/lib/api/excluir";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { exigirAdmin } from "@/src/lib/supabase/usuario";

/** Exclui a gravação: apaga o registro e, se tinha arquivo no R2, apaga o arquivo também (falha no R2 é só
 *  logada). Só admin, e só com o texto "EXCLUIR" digitado de novo. */
export async function excluirGravacaoAction(id: string, confirmacao: string): Promise<void> {
  await exigirAdmin();
  if (confirmacao !== "EXCLUIR") throw new Error('Digite "EXCLUIR" para confirmar.');
  await excluirGravacao(dbAdmin(), id);
  revalidatePath("/gravacoes");
}
