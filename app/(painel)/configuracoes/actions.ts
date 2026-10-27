"use server";
import { revalidatePath } from "next/cache";
import { siteUrl } from "@/src/lib/env";
import { montarCabecalhos, postar } from "@/src/lib/eventos";
import { corpoNovoAgendamento } from "@/src/lib/regras/avisos-equipe";
import { lerCrmEquipe, validarConfiguracao } from "@/src/lib/regras/configuracao";
import { urlValida } from "@/src/lib/regras/eventos";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";

export type Resultado = { erro?: string; ok?: boolean };

export async function salvarConfiguracao(_: Resultado, form: FormData): Promise<Resultado> {
  await exigirAdmin();
  const { dados, erro } = validarConfiguracao(form);
  if (!dados) return { erro };
  const { erro: erroCrm, ...crm } = lerCrmEquipe(form);
  if (erroCrm) return { erro: erroCrm };
  const db = await dbUsuario();
  const { error } = await db.from("configuracao").update({ ...dados, ...crm }).eq("id", 1);
  if (error) return { erro: "Não deu para salvar." };
  revalidatePath("/configuracoes");
  return { ok: true };
}

export type ResultadoTeste = { status: number | null; ok: boolean };

/** "Enviar teste" do cartão "Avisos pra equipe": manda na hora (sem fila) um aviso de novo agendamento de exemplo pra
 *  URL salva, com o segredo e a assinatura de verdade. O vendedor do exemplo é o próprio admin (WhatsApp dele na
 *  Equipe; sem ele, recusa), pra ele ver a mensagem chegar. Nunca loga o segredo. */
export async function enviarTesteEquipe(): Promise<ResultadoTeste> {
  const eu = await exigirAdmin();
  const db = dbAdmin();
  const { data: config } = await db.from("configuracao").select("crm_url_equipe, crm_segredo_equipe").eq("id", 1).maybeSingle();
  const url = (config?.crm_url_equipe as string | null | undefined) ?? null;
  if (!url || !urlValida(url)) throw new Error("Cadastre a URL antes de enviar o teste.");
  const { data: usuario } = await db.from("usuarios").select("nome, whatsapp").eq("id", eu.id).maybeSingle();
  // Sem WhatsApp do admin, não manda: um número inventado pode ser de alguém de verdade (o CRM manda mensagem real).
  const whatsapp = (usuario?.whatsapp as string | null | undefined) ?? null;
  if (!whatsapp) throw new Error("Cadastre o seu WhatsApp em Equipe: o teste chega nele.");

  const agora = new Date();
  const corpo = corpoNovoAgendamento({
    vendedor: { nome: (usuario?.nome as string | undefined) ?? eu.nome, whatsapp },
    lead: { id: "teste", nome: "Lead de Teste", whatsapp: "+551139990000", email: null, agendado_em: agora.toISOString() },
    sessao: { id: "teste", titulo: "Sessão de teste", inicio: new Date(agora.getTime() + 24 * 60 * 60_000).toISOString() },
    agenda: { id: "teste", nome: "Agenda de teste", slug: "teste" },
    resumo: "Respostas do formulário aparecem aqui.",
    reagendou: false,
    site: siteUrl(),
    agora,
  });
  corpo.id_evento = `teste:vendedor_novo_agendamento:${Date.now()}`;
  const corpoTexto = JSON.stringify(corpo);
  try {
    const r = await postar(url, montarCabecalhos((config?.crm_segredo_equipe as string | null | undefined) ?? null, corpoTexto), corpoTexto);
    return { status: r.status, ok: r.ok };
  } catch {
    return { status: null, ok: false };
  }
}
