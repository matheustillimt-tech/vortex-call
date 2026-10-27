"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { lerAgenda, lerCrm } from "@/src/lib/regras/agenda-form";
import { RESUMO_EXEMPLO, textoDoAlinhamento } from "@/src/lib/regras/alinhamento";
import { montarCorpo, urlValida, type NomeEvento } from "@/src/lib/regras/eventos";
import { montarCabecalhos } from "@/src/lib/eventos";
import { siteUrl } from "@/src/lib/env";
import { corpoParaEnvio, dadosDoCorpo, mensagemPadrao } from "@/src/lib/regras/mensagem";
import { excluirAgenda } from "@/src/lib/api/excluir";
import { agendarNoPainel } from "@/src/lib/agendar-manual";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";

export type Resultado = { erro?: string; ok?: boolean };

function erroAoSalvar(code: string | undefined, padrao: string): string {
  if (code === "23505") return "Esse endereço já é de outra agenda.";
  if (code === "23503") return "Esse responsável não existe mais. Escolha outro.";
  return padrao;
}

export async function salvarAgenda(id: string | null, _: Resultado, form: FormData): Promise<Resultado> {
  await exigirAdmin();
  const { dados, erro } = lerAgenda(form);
  if (!dados) return { erro };
  const { crm_urls, crm_segredo, disparo_url, erro: erroCrm } = lerCrm(form);
  if (erroCrm) return { erro: erroCrm };
  const atualizacao: Record<string, unknown> = { ...dados, crm_urls, disparo_url };
  if (crm_segredo !== undefined) atualizacao.crm_segredo = crm_segredo;

  const db = await dbUsuario();
  if (id) {
    const { error } = await db.from("agendas").update(atualizacao).eq("id", id);
    if (error) return { erro: erroAoSalvar(error.code, "Não deu para salvar.") };
    revalidatePath("/agendas");
    revalidatePath(`/agendas/${id}`);
    return { ok: true };
  }
  const { data, error } = await db.from("agendas").insert(atualizacao).select("id").single();
  if (error || !data) return { erro: erroAoSalvar(error?.code, "Não deu para criar.") };
  revalidatePath("/agendas");
  redirect(`/agendas/${data.id}`);
}

export type ResultadoTeste = { status: number | null; ok: boolean };

/** Manda na hora (sem fila) um corpo de exemplo pro evento escolhido (com `mensagem` e `campos`, como na entrega de
 *  verdade), com os cabeçalhos reais (segredo + assinatura),
 *  pra conferir a URL cadastrada sem esperar uma inscrição de verdade. Nunca loga o segredo. */
export async function enviarTeste(agendaId: string, evento: NomeEvento): Promise<ResultadoTeste> {
  const eu = await exigirAdmin();
  // O segredo não sai pro cliente da pessoa (grant por coluna): lido pelo servidor, depois de conferir o admin.
  const { data } = await dbAdmin().from("agendas").select("slug, nome, crm_urls, crm_segredo").eq("id", agendaId).maybeSingle();
  if (!data) throw new Error("Agenda não encontrada.");
  const url = (data.crm_urls as Record<string, string> | null)?.[evento];
  if (!url || !urlValida(url)) throw new Error("Cadastre a URL antes de enviar o teste.");
  // O "lead" do teste é o próprio admin: o fluxo do CRM manda WhatsApp de verdade, e um número inventado pode ser de
  // alguém. Sem WhatsApp do admin em Equipe, não manda.
  const { data: usuario } = await dbAdmin().from("usuarios").select("whatsapp").eq("id", eu.id).maybeSingle();
  const whatsapp = (usuario?.whatsapp as string | null | undefined) ?? null;
  if (!whatsapp) throw new Error("Cadastre o seu WhatsApp em Equipe: o teste chega nele.");

  const agora = new Date();
  const corpo = montarCorpo({
    evento,
    inscricao: { id: "teste", codigo: "teste", nome: "Lead de Teste", whatsapp, email: null, minutos_na_sala: 0 },
    sessao: { id: "teste", titulo: "Sessão de teste", inicio: new Date(agora.getTime() + 24 * 60 * 60_000).toISOString() },
    agenda: { slug: data.slug, nome: data.nome },
    site: siteUrl(),
    agora,
    resumo: evento === "resumo" ? { texto: textoDoAlinhamento(RESUMO_EXEMPLO, "RESUMO DA CALL (teste)"), dados: RESUMO_EXEMPLO } : undefined,
    venda: evento === "comprou" ? { pedido: "teste", produto: "Produto de teste", valorCentavos: 199700, compradaEm: agora.toISOString() } : undefined,
  });
  corpo.id_evento = `teste:${evento}:${Date.now()}`;
  // Mesma `mensagem` (texto fixo padrão) e mesmos `campos` da entrega de verdade, pra testar o fluxo do CRM com
  // `{{evento.mensagem}}`.
  const mensagem = mensagemPadrao(evento, dadosDoCorpo(corpo));
  const corpoTexto = JSON.stringify(corpoParaEnvio(evento, corpo, mensagem));
  const headers = montarCabecalhos((data.crm_segredo as string | null) ?? null, corpoTexto);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const resposta = await fetch(url, { method: "POST", headers, body: corpoTexto, signal: controller.signal });
    return { status: resposta.status, ok: resposta.ok };
  } catch {
    return { status: null, ok: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Volta um evento `falhou` pra `pendente` com `proxima_em = now`, pra rotina de entrega tentar de novo já. */
export async function tentarDeNovo(eventoId: string): Promise<void> {
  await exigirAdmin();
  const db = await dbUsuario();
  const { data, error } = await db
    .from("eventos")
    .update({ status: "pendente", tentativas: 0, proxima_em: new Date().toISOString() })
    .eq("id", eventoId)
    .eq("status", "falhou")
    .select("agenda_id")
    .maybeSingle();
  if (error) throw new Error("Não deu para tentar de novo.");
  if (data) revalidatePath(`/agendas/${data.agenda_id}/avisos`);
}

/** Exclui a agenda e tudo que é dela (sessões, inscrições, gravações…), em cascata no banco. Só admin, e só com o
 *  texto "EXCLUIR" digitado de novo. Não redireciona: o `redirect()` do Next lança um erro especial que o
 *  botão mostraria como falha; quem leva pra lista é o `BotaoExcluir` (prop `depois`) (o modal já confere no cliente; aqui é a confirmação de verdade). */
export async function excluirAgendaAction(id: string, confirmacao: string): Promise<void> {
  await exigirAdmin();
  if (confirmacao !== "EXCLUIR") throw new Error('Digite "EXCLUIR" para confirmar.');
  await excluirAgenda(dbAdmin(), id);
  revalidatePath("/agendas");
}

export type ResultadoAgendar = { erro?: string; ok?: boolean; link?: string; resultado?: "nova" | "reagendada" | "mesma" };

/** "Agendar pessoa" da aba Agendas (só admin): cadastra o lead na sessão escolhida, como se tivesse agendado pela
 *  página (sem a janela de dias). Devolve o link pessoal da sala pra copiar. */
export async function agendarPessoa(agendaId: string, _: ResultadoAgendar, form: FormData): Promise<ResultadoAgendar> {
  await exigirAdmin();
  const r = await agendarNoPainel(agendaId, {
    sessao: String(form.get("sessao") ?? ""),
    nome: String(form.get("nome") ?? ""),
    whatsapp: String(form.get("whatsapp") ?? ""),
    email: String(form.get("email") ?? ""),
  });
  if ("erro" in r) return { erro: r.erro };
  revalidatePath("/agendas");
  revalidatePath("/sessoes");
  return { ok: true, link: r.link, resultado: r.resultado };
}
