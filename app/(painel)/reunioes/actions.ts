"use server";
import { revalidatePath } from "next/cache";
import { excluirReuniao } from "@/src/lib/api/excluir";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { exigirAdmin } from "@/src/lib/supabase/usuario";

/** Exclui a reunião instantânea (em cascata: a gravação dela). Reunião ainda não encerrada tem a sala desligada
 *  antes. Só admin, e só com o texto "EXCLUIR" digitado de novo. */
export async function excluirReuniaoAction(id: string, confirmacao: string): Promise<void> {
  await exigirAdmin();
  if (confirmacao !== "EXCLUIR") throw new Error('Digite "EXCLUIR" para confirmar.');
  await excluirReuniao(dbAdmin(), id);
  revalidatePath("/reunioes");
}
