import "server-only";
import { iaConfig } from "./env";
import { enfileirar } from "./eventos";
import { completarJson } from "./openrouter";
import {
  equipeDaTranscricao, lerAlinhamento, minutosDeFala, montarPromptAlinhamento, textoDoAlinhamento, MIN_MINUTOS_FALA, TEXTO_MAX, type Alinhamento,
} from "./regras/alinhamento";
import { resolverMeetingId } from "./regras/meeting-id";
import { juntarTrechos, lerTranscricaoCloudflare, transcricaoEmTexto, type Trecho } from "./regras/transcricao";
import { dbAdmin } from "./supabase/admin";
import { listarTrechos } from "./transcricao";

/** Depois da avaliação de presença, espera a transcrição da Cloudflare por até 15 min. */
export const ESPERA_TRANSCRICAO_MIN = 15;
const MAX_TENTATIVAS = 3;
const REPETIR_MIN = 5;
/** Enquanto uma rotina gera, a sessão fica reservada por 10 min (outra rotina não pega a mesma). */
const RESERVA_MIN = 10;
const DOWNLOAD_MS = 15_000;

const minutos = (d: Date, min: number) => new Date(d.getTime() + min * 60_000).toISOString();

/** Põe a sessão na fila do resumo final a partir de `apos`. Só se ainda não está (`soSeVazio`) ou, com transcrição
 *  nova da Cloudflare, de novo (inclusive se já estava pronta: aí o resumo é refeito com ela). */
export async function marcarResumoPendente(sessaoId: string, apos: Date, soSeVazio: boolean): Promise<void> {
  let q = dbAdmin().from("sessoes").update({ resumo_estado: "pendente", resumo_apos: apos.toISOString(), resumo_tentativas: 0 }).eq("id", sessaoId);
  if (soSeVazio) q = q.is("resumo_estado", null);
  const { error } = await q;
  if (error) throw new Error(`Não foi possível pôr o resumo na fila: ${error.message}`);
}

/** Webhook `meeting.transcript`: baixa o arquivo na hora (o link vence), grava em `transcricoes` e antecipa o resumo
 *  final pra já. Meeting que não é de sessão transcrita é ignorada. */
export async function receberTranscricao(payload: Record<string, unknown>, f: typeof fetch = fetch): Promise<void> {
  const meetingId = resolverMeetingId(payload);
  const meeting = (payload.meeting && typeof payload.meeting === "object" ? payload.meeting : {}) as Record<string, unknown>;
  const url = typeof payload.transcriptDownloadUrl === "string" ? payload.transcriptDownloadUrl : null;
  const rtkSession = typeof meeting.sessionId === "string" ? meeting.sessionId : null;
  if (!meetingId || !url || !rtkSession) {
    console.error("[resumo] meeting.transcript incompleto", Object.keys(payload));
    return;
  }
  const db = dbAdmin();
  const { data: sessao } = await db.from("sessoes").select("id, rtk_transcreve").eq("rtk_meeting_id", meetingId).maybeSingle();
  if (!sessao || sessao.rtk_transcreve !== true) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_MS);
  let arquivo: string;
  try {
    const r = await f(url, { signal: controller.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    arquivo = await r.text();
  } finally {
    clearTimeout(timer);
  }
  const base = new Date(typeof meeting.startedAt === "string" ? meeting.startedAt : Date.now());
  const trechos = lerTranscricaoCloudflare(arquivo, base, rtkSession);
  const { error } = await db
    .from("transcricoes")
    .upsert({ sessao_id: sessao.id, rtk_session_id: rtkSession, conteudo: trechos, recebida_em: new Date().toISOString() }, { onConflict: "rtk_session_id" });
  if (error) throw new Error(`Não foi possível gravar a transcrição: ${error.message}`);
  await marcarResumoPendente(sessao.id as string, new Date(), false);
}

/** Falas pro resumo final: a transcrição da Cloudflare (todas as sessões do RealtimeKit da sala), senão a do ao vivo. */
async function falasDaSessao(sessaoId: string): Promise<{ trechos: Trecho[]; origem: "cloudflare" | "ao_vivo" }> {
  const { data } = await dbAdmin().from("transcricoes").select("conteudo").eq("sessao_id", sessaoId);
  const listas = (data ?? []).map((l) => (Array.isArray(l.conteudo) ? (l.conteudo as Trecho[]) : []));
  const daCloudflare = juntarTrechos(...listas);
  if (daCloudflare.length > 0) return { trechos: daCloudflare, origem: "cloudflare" };
  return { trechos: await listarTrechos(sessaoId), origem: "ao_vivo" };
}

const DATA_HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** "RESUMO DA CALL (26/10 15:00, 42 min, conduzida por Gabriel)" + linha de call em grupo. */
export function cabecalhoDoResumo(o: { inicio: string; minutos: number; conduzidaPor: string | null; leads: number }): string {
  const partes = [DATA_HORA.format(new Date(o.inicio)).replace(",", ""), `${Math.max(1, Math.round(o.minutos))} min`];
  if (o.conduzidaPor) partes.push(`conduzida por ${o.conduzidaPor}`);
  const linha = `RESUMO DA CALL (${partes.join(", ")})`;
  return o.leads > 1 ? `${linha}\nCall em grupo com ${o.leads} leads` : linha;
}

export type ResultadoResumo = "nenhum" | "pronto" | "sem_fala" | "repetir" | "falhou";

/** Uma rodada da rotina /api/cron/resumos: pega a sessão `pendente` mais antiga que já pode (e já foi avaliada:
 *  o `compareceu` precisa estar marcado), reserva, gera o resumo final e manda o evento `resumo` pra cada inscrição
 *  que veio. Com menos de 3 min de conversa, `sem_fala` (sem evento). IA falhou: tenta de novo em 5 min; na 3ª,
 *  `falhou` e o evento sai com o começo da transcrição no lugar do resumo. */
export async function gerarProximoResumo(agora: Date = new Date(), f: typeof fetch = fetch): Promise<ResultadoResumo> {
  const db = dbAdmin();
  const { data: fila } = await db
    .from("sessoes")
    .select("id, titulo, inicio, anfitriao_id, resumo_apos, resumo_tentativas, agendas(nome)")
    .eq("resumo_estado", "pendente")
    .lte("resumo_apos", agora.toISOString())
    .not("avaliada_em", "is", null)
    .order("resumo_apos", { ascending: true })
    .limit(1);
  const s = (fila ?? [])[0] as
    | { id: string; titulo: string | null; inicio: string; anfitriao_id: string | null; resumo_apos: string; resumo_tentativas: number; agendas: unknown }
    | undefined;
  if (!s) return "nenhum";

  // Reserva otimista: só segue quem trocou o `resumo_apos` que leu.
  const { data: reservada } = await db
    .from("sessoes")
    .update({ resumo_apos: minutos(agora, RESERVA_MIN) })
    .eq("id", s.id)
    .eq("resumo_estado", "pendente")
    .eq("resumo_apos", s.resumo_apos)
    .select("id")
    .maybeSingle();
  if (!reservada) return "nenhum";

  const { trechos, origem } = await falasDaSessao(s.id);
  const fim = async (estado: "pronto" | "sem_fala" | "falhou") => {
    const { error } = await db.from("sessoes").update({ resumo_estado: estado, resumo_apos: null }).eq("id", s.id);
    if (error) throw new Error(`Não foi possível marcar o resumo: ${error.message}`);
  };
  const duracao = minutosDeFala(trechos);
  if (trechos.length === 0 || duracao < MIN_MINUTOS_FALA) {
    await fim("sem_fala");
    return "sem_fala";
  }

  const { data: vieram } = await db.from("inscricoes").select("id, whatsapp").eq("sessao_id", s.id).eq("status", "compareceu");
  const leads = (vieram ?? []) as { id: string; whatsapp: string }[];
  let conduzidaPor: string | null = null;
  if (s.anfitriao_id) {
    const { data: u } = await db.from("usuarios").select("nome").eq("id", s.anfitriao_id).maybeSingle();
    conduzidaPor = ((u?.nome as string | undefined) ?? "").trim().split(/\s+/)[0] || null;
  }
  const cabecalho = cabecalhoDoResumo({ inicio: s.inicio, minutos: duracao, conduzidaPor, leads: leads.length });
  const ag = (Array.isArray(s.agendas) ? s.agendas[0] : s.agendas) as { nome?: string } | null;
  const transcricao = transcricaoEmTexto(trechos);

  let dados: Alinhamento | null = null;
  const ia = iaConfig();
  if (ia) {
    try {
      const pedido = montarPromptAlinhamento({ transcricao, agenda: s.titulo || ag?.nome || "Call", equipe: equipeDaTranscricao(trechos), final: true });
      dados = lerAlinhamento(await completarJson({ ...pedido, maxTokens: 1500, temperatura: 0.2, prazoMs: 45_000 }, ia, f));
    } catch {
      dados = null;
    }
  }

  let texto: string;
  if (dados) {
    texto = textoDoAlinhamento(dados, cabecalho);
    const { error } = await db
      .from("alinhamentos")
      .upsert(
        { sessao_id: s.id, tipo: "final", origem, dados, texto, total_trechos: trechos.length, gerado_em: agora.toISOString() },
        { onConflict: "sessao_id,tipo" },
      );
    if (error) throw new Error(`Não foi possível gravar o resumo: ${error.message}`);
  } else {
    const tentativas = s.resumo_tentativas + 1;
    if (tentativas < MAX_TENTATIVAS) {
      await db.from("sessoes").update({ resumo_tentativas: tentativas, resumo_apos: minutos(agora, REPETIR_MIN) }).eq("id", s.id);
      return "repetir";
    }
    const aviso = `${cabecalho}\nO resumo automático falhou. Começo da transcrição:\n`;
    texto = `${aviso}${transcricao}`.slice(0, TEXTO_MAX);
  }

  for (const lead of leads) {
    try {
      await enfileirar("resumo", lead.id, agora, { resumo: { texto, dados: dados ?? null } });
    } catch (e) {
      console.error("[resumo] não enfileirou o evento", lead.id, e instanceof Error ? e.message : "erro");
    }
    const { error } = await db
      .from("fichas")
      .upsert({ whatsapp: lead.whatsapp, observacoes_call: texto.slice(0, 4000), observacoes_call_em: agora.toISOString() }, { onConflict: "whatsapp" });
    if (error) console.error("[resumo] não gravou na ficha", lead.id, error.message);
  }
  await fim(dados ? "pronto" : "falhou");
  return dados ? "pronto" : "falhou";
}
