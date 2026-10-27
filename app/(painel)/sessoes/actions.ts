"use server";
import { revalidatePath } from "next/cache";
import { cancelarSessao as cancelarSessaoNoBanco, criarSessao as criarSessaoNoBanco } from "@/src/lib/api/sessoes";
import { excluirSessao } from "@/src/lib/api/excluir";
import { trocarHorario } from "@/src/lib/agendar-manual";
import { SO_GESTOR, gestorDaAgenda, gestorDaRepeticao, gestorDaSessao } from "@/src/lib/acesso";
import { TEM_INSCRITOS } from "@/src/lib/regras/acesso";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { localParaUtc } from "@/src/lib/regras/fuso";
import { gerarSessoesRepetidas } from "@/src/lib/sessoes-repetidas";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario, exigirAdmin, type Membro } from "@/src/lib/supabase/usuario";

export type Resultado = { erro?: string; ok?: boolean };
const FUSO = "America/Sao_Paulo";
const NAO_AGENDADA = "Só dá para mexer em sessão agendada.";

/* Horários (sessão avulsa, repetição, vagas e cancelar sessão vazia): admin OU o responsável pela agenda (vendedor).
 * Confere com `gestorDa*` (src/lib/acesso.ts) e só então grava pela service role; os grants por coluna da equipe
 * continuam iguais. Excluir segue só do admin. Membro sem a permissão `horarios` não faz nenhuma destas. */

/** Erro pra quem não pode mexer nos horários (não é gestor da agenda, ou é membro sem `horarios`); null = pode. */
function recusa(eu: Membro | null): string | null {
  if (!eu) return SO_GESTOR;
  return pode(eu, "horarios") ? null : SEM_PERMISSAO;
}

function atualizarTelas(sessaoId?: string) {
  revalidatePath("/sessoes");
  revalidatePath("/horarios");
  if (sessaoId) revalidatePath(`/sessoes/${sessaoId}`);
}

export async function criarSessao(_: Resultado, form: FormData): Promise<Resultado> {
  const agenda_id = String(form.get("agenda_id") ?? "");
  if (!agenda_id) return { erro: "Escolha a agenda." };
  const erro = recusa(await gestorDaAgenda(agenda_id));
  if (erro) return { erro };
  const r = await criarSessaoNoBanco(dbAdmin(), {
    agenda_id,
    inicio: localParaUtc(String(form.get("inicio") ?? ""), FUSO),
    vagas: Number(form.get("vagas")),
    titulo: String(form.get("titulo") ?? "").trim() || null,
  });
  if ("erro" in r) return { erro: r.erro };
  atualizarTelas();
  return { ok: true };
}

export async function criarRepeticao(_: Resultado, form: FormData): Promise<Resultado> {
  const agenda_id = String(form.get("agenda_id") ?? "");
  const dias_semana = form.getAll("dias").map(Number).filter((d) => d >= 0 && d <= 6);
  const hora = String(form.get("hora") ?? "");
  const vagas = Number(form.get("vagas"));
  const ate = String(form.get("ate") ?? "") || null;
  if (!agenda_id) return { erro: "Escolha a agenda." };
  if (!dias_semana.length) return { erro: "Marque pelo menos um dia." };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return { erro: "Hora inválida." };
  if (!(Number.isInteger(vagas) && vagas >= 1 && vagas <= 500)) return { erro: "Vagas: de 1 a 500." };
  const erro = recusa(await gestorDaAgenda(agenda_id));
  if (erro) return { erro };
  const { error } = await dbAdmin().from("repeticoes").insert({ agenda_id, dias_semana, hora, vagas, ate });
  if (error) return { erro: "Não deu para salvar a repetição." };
  await gerarSessoesRepetidas();
  atualizarTelas();
  return { ok: true };
}

/** Para a repetição (as sessões já criadas ficam; o cron só não cria novas). */
export async function pararRepeticao(id: string): Promise<Resultado> {
  const erro = recusa(await gestorDaRepeticao(id));
  if (erro) return { erro };
  const { error } = await dbAdmin().from("repeticoes").update({ ativa: false }).eq("id", id);
  if (error) return { erro: "Não deu para parar a repetição." };
  atualizarTelas();
  return { ok: true };
}

/** Muda as vagas de sessão agendada, nunca abaixo dos inscritos ativos (conta e grava juntas, na função SQL). */
export async function alterarVagas(sessaoId: string, _: Resultado, form: FormData): Promise<Resultado> {
  const vagas = Number(form.get("vagas"));
  if (!(Number.isInteger(vagas) && vagas >= 1 && vagas <= 500)) return { erro: "Vagas: de 1 a 500." };
  const erro = recusa(await gestorDaSessao(sessaoId));
  if (erro) return { erro };
  const { data, error } = await dbAdmin().rpc("alterar_vagas_sessao", { p_sessao: sessaoId, p_vagas: vagas });
  if (error || !data) return { erro: "Não deu para mudar as vagas." };
  const r = data as { resultado: string; inscritos: number };
  if (r.resultado === "abaixo_inscritos") return { erro: `Essa sessão já tem ${r.inscritos} inscritos: as vagas não podem ficar abaixo disso.` };
  if (r.resultado === "nao_agendada") return { erro: NAO_AGENDADA };
  if (r.resultado === "nao_encontrada") return { erro: "Sessão não encontrada." };
  if (r.resultado !== "ok") return { erro: "Vagas: de 1 a 500." };
  atualizarTelas(sessaoId);
  return { ok: true };
}

/** Admin: cancela como antes (com inscritos, que viram `cancelado`). Responsável (membro): só sessão sem inscrito
 *  ativo, conferido na hora pela função SQL `cancelar_sessao_vazia` (trava a sessão, nenhuma inscrição entra no meio). */
export async function cancelarSessao(id: string): Promise<Resultado> {
  const eu = await gestorDaSessao(id);
  const erro = recusa(eu);
  if (erro || !eu) return { erro: erro ?? SO_GESTOR };
  if (eu.papel === "admin") {
    const r = await cancelarSessaoNoBanco(await dbUsuario(), id);
    if (r === "nao_encontrada") return { erro: "Sessão não encontrada." };
    if (r === "nao_agendada") return { erro: NAO_AGENDADA };
  } else {
    const { data, error } = await dbAdmin().rpc("cancelar_sessao_vazia", { p_sessao: id });
    if (error) throw new Error("Não deu para cancelar.");
    if (data === "tem_inscritos") return { erro: TEM_INSCRITOS };
    if (data === "nao_agendada") return { erro: NAO_AGENDADA };
    if (data !== "ok") return { erro: "Sessão não encontrada." };
  }
  atualizarTelas(id);
  return { ok: true };
}

/** Exclui a sessão (em cascata: inscrições, presenças, eventos, gravações…). Sessão `ao_vivo` tem a sala desligada
 *  antes. Só admin, e só com o texto "EXCLUIR" digitado de novo. Não redireciona: o `redirect()` do Next lança um erro especial que o
 *  botão mostraria como falha; quem leva pra lista é o `BotaoExcluir` (prop `depois`). */
export async function excluirSessaoAction(id: string, confirmacao: string): Promise<void> {
  await exigirAdmin();
  if (confirmacao !== "EXCLUIR") throw new Error('Digite "EXCLUIR" para confirmar.');
  await excluirSessao(dbAdmin(), id);
  revalidatePath("/sessoes");
}

/** "Trocar horário" de um inscrito (página da sessão): mesma regra dos horários (admin ou responsável pela agenda,
 *  com `horarios`). A pessoa recebe o "agendou" com o horário novo; o link da sala continua o mesmo. */
export async function trocarHorarioAction(inscricaoId: string, sessaoAtual: string, _: Resultado, form: FormData): Promise<Resultado> {
  const erro = recusa(await gestorDaSessao(sessaoAtual));
  if (erro) return { erro };
  const sessaoNova = String(form.get("sessao") ?? "");
  if (!sessaoNova) return { erro: "Escolha o novo horário." };
  const r = await trocarHorario(inscricaoId, sessaoAtual, sessaoNova);
  if ("erro" in r) return { erro: r.erro };
  atualizarTelas(sessaoAtual);
  revalidatePath(`/sessoes/${sessaoNova}`);
  return { ok: true };
}
