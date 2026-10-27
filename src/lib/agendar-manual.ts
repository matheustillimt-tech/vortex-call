import "server-only";
import { avisarNovoAgendamento } from "./avisos-equipe";
import { siteUrl } from "./env";
import { enfileirar } from "./eventos";
import { ehColisaoDeCodigo, gerarCodigo } from "./regras/codigo";
import { validarInscricao } from "./regras/inscricao";
import { dbAdmin } from "./supabase/admin";

/** Agendamento manual pelo painel (aba Agendas → "Agendar pessoa"): o admin cadastra nome, WhatsApp e e-mail e
 *  escolhe a sessão. Usa a mesma função `inscrever` do agendamento público (origem `painel`), sem a janela de dias
 *  nem o limite contra robô; o "agendou" pro lead e o aviso pro vendedor saem igual. Devolve o link pessoal da sala
 *  (o admin é de confiança, então devolve também quando a pessoa já estava inscrita). */
export type ResultadoManual = { ok: true; link: string; resultado: "nova" | "reagendada" | "mesma" } | { erro: string };

export async function agendarNoPainel(agendaId: string, entrada: { sessao: string; nome: string; whatsapp: string; email: string }): Promise<ResultadoManual> {
  const { dados, erro } = validarInscricao(entrada);
  if (!dados) return { erro: erro === "Informe seu nome." ? "Informe o nome." : erro === "Confira o WhatsApp com DDD." ? "Confira o telefone com DDD." : erro ?? "Confira os dados." };
  const db = dbAdmin();
  const { data: sessao } = await db.from("sessoes").select("id, agenda_id").eq("id", dados.sessao).maybeSingle();
  if (!sessao || (sessao as { agenda_id: string }).agenda_id !== agendaId) return { erro: "Esse horário não é desta agenda." };

  const chamar = (codigo: string) =>
    db.rpc("inscrever", {
      p_sessao: dados.sessao, p_codigo: codigo, p_nome: dados.nome, p_whatsapp: dados.whatsapp, p_email: dados.email,
      p_resposta: null, p_respostas: null, p_utm: {}, p_origem: "painel",
    });
  let { data, error } = await chamar(gerarCodigo());
  if (error && ehColisaoDeCodigo(error)) ({ data, error } = await chamar(gerarCodigo()));
  const r = (data as { resultado: string; inscricao_id: string | null; codigo: string | null }[] | null)?.[0];
  if (error || !r) return { erro: "Não deu para agendar. Tente de novo." };
  if (r.resultado === "lotada") return { erro: "Essa sessão está lotada. Aumente as vagas dela em Sessões ou escolha outro horário." };
  if (r.resultado === "indisponivel" || !r.codigo || !r.inscricao_id) return { erro: "Essa sessão não está mais disponível." };

  if (r.resultado === "nova" || r.resultado === "reagendada") {
    try {
      await enfileirar("agendou", r.inscricao_id);
    } catch (e) {
      console.error("[crm] não enfileirou agendou (painel)", e instanceof Error ? e.message : "erro");
    }
    try {
      await avisarNovoAgendamento(r.inscricao_id, r.resultado === "reagendada");
    } catch (e) {
      console.error("[equipe] não avisou o vendedor (painel)", e instanceof Error ? e.message : "erro");
    }
  }
  return { ok: true, link: `${siteUrl()}/c/${r.codigo}`, resultado: r.resultado as "nova" | "reagendada" | "mesma" };
}

/** "Trocar horário" da página da sessão: leva um inscrito agendado pra outra sessão da mesma agenda. É o
 *  `agendarNoPainel` com os dados que a inscrição já tem: a função `inscrever` acha a pessoa pelo WhatsApp e muda a
 *  sessão (mesmo código, mesmo link da sala); o "agendou" com o horário novo e o aviso pro vendedor saem igual. Os
 *  lembretes da sessão velha deixam de valer sozinhos (o evento confere a sessão da inscrição). `sessaoAtual` é a
 *  sessão em que quem pediu tem acesso: a inscrição tem que estar nela. */
export async function trocarHorario(inscricaoId: string, sessaoAtual: string, sessaoNova: string): Promise<ResultadoManual> {
  const { data: i } = await dbAdmin().from("inscricoes").select("agenda_id, sessao_id, nome, whatsapp, email, status").eq("id", inscricaoId).maybeSingle();
  const insc = i as { agenda_id: string; sessao_id: string; nome: string; whatsapp: string; email: string | null; status: string } | null;
  if (!insc) return { erro: "Inscrição não encontrada." };
  if (insc.sessao_id !== sessaoAtual) return { erro: "Essa pessoa não está mais nesta sessão. Atualize a página." };
  if (insc.status !== "agendado") return { erro: "Só dá para trocar o horário de quem está agendado." };
  if (insc.sessao_id === sessaoNova) return { erro: "Escolha um horário diferente do atual." };
  return agendarNoPainel(insc.agenda_id, { sessao: sessaoNova, nome: insc.nome, whatsapp: insc.whatsapp, email: insc.email ?? "" });
}
