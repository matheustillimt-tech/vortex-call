"use server";
import { revalidatePath } from "next/cache";
import { lerWhatsappEquipe, validarPessoa } from "@/src/lib/regras/equipe";
import { limparPermissoes } from "@/src/lib/regras/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";

export type Resultado = { erro?: string; ok?: boolean };

/** Admin cria a pessoa com e-mail e senha (passada a ela por fora). Não existe cadastro aberto. */
export async function criarPessoa(_: Resultado, form: FormData): Promise<Resultado> {
  await exigirAdmin();
  const d = {
    nome: String(form.get("nome") ?? ""),
    email: String(form.get("email") ?? "").trim().toLowerCase(),
    senha: String(form.get("senha") ?? ""),
    papel: String(form.get("papel") ?? "membro"),
  };
  const erro = validarPessoa(d);
  if (erro) return { erro };
  const wa = lerWhatsappEquipe(String(form.get("whatsapp") ?? ""));
  if ("erro" in wa) return { erro: wa.erro };

  const admin = dbAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email: d.email, password: d.senha, email_confirm: true });
  if (error || !data.user) return { erro: error?.message.includes("already") ? "Esse e-mail já tem acesso." : "Não deu para criar o acesso." };

  const { error: erroTabela } = await admin.from("usuarios").insert({ auth_id: data.user.id, nome: d.nome.trim(), email: d.email, papel: d.papel, whatsapp: wa.whatsapp });
  if (erroTabela) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { erro: "Não deu para salvar a pessoa." };
  }
  revalidatePath("/equipe");
  return { ok: true };
}

/** Edita a categoria e o WhatsApp (avisos do vendedor) de alguém da equipe. A própria pessoa só muda o WhatsApp.
 *  Erro de validação volta em `erro` (mensagem de `throw` some em produção). */
export async function editarPessoa(id: string, d: { papel: "admin" | "membro"; whatsapp: string }): Promise<Resultado> {
  const eu = await exigirAdmin();
  if (d.papel !== "admin" && d.papel !== "membro") return { erro: "Papel inválido." };
  if (id === eu.id && d.papel !== eu.papel) return { erro: "Você não pode mudar o próprio papel." };
  const wa = lerWhatsappEquipe(d.whatsapp);
  if ("erro" in wa) return { erro: wa.erro };
  const valores = id === eu.id ? { whatsapp: wa.whatsapp } : { papel: d.papel, whatsapp: wa.whatsapp };
  const db = await dbUsuario();
  const { error } = await db.from("usuarios").update(valores).eq("id", id);
  if (error) return { erro: "Não deu para salvar a alteração." };
  revalidatePath("/equipe");
  return { ok: true };
}

export async function mudarAtivo(id: string, ativo: boolean): Promise<void> {
  const eu = await exigirAdmin();
  if (id === eu.id) throw new Error("Você não pode desativar o próprio acesso.");
  const db = await dbUsuario();
  const { error } = await db.from("usuarios").update({ ativo }).eq("id", id);
  if (error) throw new Error("Não deu para salvar a alteração.");
  revalidatePath("/equipe");
}

/** Permissões de um membro (Equipe → "Permissões"). Só admin; não mexe em admin (que tem tudo sempre). Só as chaves
 *  conhecidas com valor booleano entram; o resto fica no padrão. Vale na hora (o servidor e o banco leem a cada pedido). */
export async function salvarPermissoes(id: string, entrada: unknown): Promise<Resultado> {
  await exigirAdmin();
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return { erro: "Permissões inválidas." };
  const db = await dbUsuario();
  const { data: alvo } = await db.from("usuarios").select("id, papel").eq("id", id).maybeSingle();
  if (!alvo) return { erro: "Usuário não encontrado." };
  if ((alvo as { papel: string }).papel === "admin") return { erro: "Admin tem acesso a tudo." };
  const { error } = await db.from("usuarios").update({ permissoes: limparPermissoes(entrada) }).eq("id", id);
  if (error) return { erro: "Não deu para salvar as permissões." };
  revalidatePath("/equipe");
  return { ok: true };
}
