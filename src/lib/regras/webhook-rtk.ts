import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prefixoNoBucket } from "../gravacao";
import { registrarEntrada, registrarSaida } from "../presenca";
import { receberTranscricao } from "../resumo-final";
import { acharPorPrefixo, r2Config } from "../r2";
import { fimProgramado } from "./estado-sala";
import { resolverMeetingId } from "./meeting-id";

const UMA_HORA_MS = 60 * 60 * 1000;
const CINCO_MIN_MS = 5 * 60 * 1000;
let chaveCache: { pem: string; expiraEm: number; obtidaEm: number } | null = null;

/** Chave pública do RealtimeKit (PEM) pra verificar assinatura dos webhooks. Fica em cache em memória por 1h
 *  pra não bater em `.well-known/webhooks.json` a cada entrega. */
export async function obterChavePublica(): Promise<string> {
  const agora = Date.now();
  if (chaveCache && chaveCache.expiraEm > agora) return chaveCache.pem;
  return buscarChavePublica();
}

async function buscarChavePublica(): Promise<string> {
  const agora = Date.now();
  const resp = await fetch("https://api.realtime.cloudflare.com/.well-known/webhooks.json");
  if (!resp.ok) throw new Error("Não foi possível obter a chave pública do RealtimeKit.");
  const json = (await resp.json()) as { data?: { publicKey?: string } };
  const pem = json.data?.publicKey;
  if (!pem) throw new Error("Chave pública do RealtimeKit ausente na resposta.");
  chaveCache = { pem, expiraEm: agora + UMA_HORA_MS, obtidaEm: agora };
  return pem;
}

/** Depois de uma assinatura recusada: se a chave em cache tem mais de 5 min, busca de novo (a Cloudflare pode
 *  ter trocado a chave) e devolve a nova; senão devolve `null`. O limite de 5 min impede que requisições com
 *  assinatura falsa forcem uma busca a cada entrega. */
export async function renovarChaveSeVelha(): Promise<string | null> {
  if (chaveCache && Date.now() - chaveCache.obtidaEm < CINCO_MIN_MS) return null;
  return buscarChavePublica();
}

/** Verifica a assinatura RSA-SHA256 (Base64) sobre o corpo bruto da requisição. Nunca lança: chave ou assinatura
 *  malformada (base64 inválido, PEM errado) só devolvem `false`. */
export async function verificarAssinatura(chavePem: string, assinaturaB64: string, corpo: ArrayBuffer): Promise<boolean> {
  try {
    const pemLimpo = chavePem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, "");
    const chaveBytes = Buffer.from(pemLimpo, "base64");
    const chave = await crypto.subtle.importKey(
      "spki",
      chaveBytes,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const assinaturaBytes = Buffer.from(assinaturaB64, "base64");
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", chave, assinaturaBytes, corpo);
  } catch {
    return false;
  }
}

type PayloadGravacao = {
  id?: string;
  status?: string;
  downloadUrl?: string;
  recordingDuration?: number;
  startedTime?: string;
  stoppedTime?: string;
  meetingId?: string;
  outputFileName?: string;
};

/** Gravação pronta (UPLOADED) com R2 configurado: acha o arquivo no bucket pelo prefixo ÚNICO que o Vórtex Call
 *  escolheu ao começar a gravar (`r2_prefixo`). Sem prefixo (gravação antiga ou começada fora daqui) não adivinha:
 *  loga e fica `null`. Arquivo ainda não apareceu ou R2 fora do ar → `null` e log (o link tenta de novo depois, em
 *  `linkGravacao`). Nunca loga chave nem link. */
async function chaveNoR2(recording: PayloadGravacao, prefixo: string | null | undefined): Promise<string | null> {
  if (!r2Config()) return null;
  if (!prefixo) {
    console.warn("[webhook rtk] gravação pronta sem prefixo do R2", recording.id);
    return null;
  }
  try {
    const chave = await acharPorPrefixo(prefixoNoBucket(prefixo), recording.outputFileName ?? null);
    if (!chave) console.warn("[webhook rtk] gravação pronta ainda sem arquivo no R2", recording.id);
    return chave;
  } catch (e) {
    console.error("[webhook rtk] não deu para procurar a gravação no R2", recording.id, e instanceof Error ? e.message : "erro");
    return null;
  }
}

async function processarGravacao(
  db: SupabaseClient,
  recording: PayloadGravacao | undefined,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!recording?.id) return;
  const meetingRaiz = payload.meeting as { id?: string } | undefined;
  const meetingId = recording.meetingId ?? meetingRaiz?.id;
  let sessaoId: string | null = null;
  let reuniaoId: string | null = null;
  if (meetingId) {
    const { data: sessao } = await db.from("sessoes").select("id").eq("rtk_meeting_id", meetingId).maybeSingle();
    sessaoId = (sessao?.id as string | undefined) ?? null;
    // Meeting que não é de sessão pode ser de reunião instantânea (`/r/{codigo}`).
    if (!sessaoId) {
      const { data: reuniao } = await db.from("reunioes").select("id").eq("rtk_meeting_id", meetingId).maybeSingle();
      reuniaoId = (reuniao?.id as string | undefined) ?? null;
    }
  }
  // Eventos podem chegar fora de ordem: depois de UPLOADED (tem o link do arquivo) nenhum outro status volta atrás.
  const { data: atual } = await db
    .from("gravacoes")
    .select("status, download_url, r2_chave, r2_prefixo")
    .eq("rtk_recording_id", recording.id)
    .maybeSingle();
  const salvo = atual as { status?: string; download_url?: string | null; r2_chave?: string | null; r2_prefixo?: string | null } | null;
  const manterUpload = salvo?.status === "UPLOADED" && recording.status !== "UPLOADED";
  // `r2_chave` só entra no upsert quando foi achada agora; `r2_prefixo` nunca entra (quem grava é `comecarGravacao`):
  // nos outros casos o valor salvo fica como está.
  const r2Chave = recording.status === "UPLOADED" && !salvo?.r2_chave ? await chaveNoR2(recording, salvo?.r2_prefixo) : null;
  const { error } = await db.from("gravacoes").upsert(
    {
      ...(r2Chave ? { r2_chave: r2Chave } : {}),
      rtk_recording_id: recording.id,
      sessao_id: sessaoId,
      reuniao_id: reuniaoId,
      status: manterUpload ? "UPLOADED" : (recording.status ?? "DESCONHECIDO"),
      download_url: manterUpload ? (salvo?.download_url ?? null) : (recording.downloadUrl ?? null),
      // A RealtimeKit manda a duração com casas decimais (ex.: 28.963) e a coluna é inteira.
      duracao_s: recording.recordingDuration == null ? null : Math.round(recording.recordingDuration),
      iniciada_em: recording.startedTime ?? null,
      terminada_em: recording.stoppedTime ?? null,
    },
    { onConflict: "rtk_recording_id" },
  );
  if (error) throw new Error(`Não foi possível salvar a gravação: ${error.message}`);
}

/** `meeting.ended` chega tanto quando o anfitrião encerra quanto quando todo mundo sai (inclusive o anfitrião que
 *  abriu cedo pra testar e saiu). Só fecha a sessão `ao_vivo` se o anfitrião encerrou de fato
 *  (`HOST_ENDED_MEETING`) ou se já passou do fim programado (início + duração); senão ela continua ao vivo e a
 *  sala pode ser reaberta. Sessão esquecida ao vivo é fechada pelo cron depois do prazo final. Reunião instantânea
 *  não muda aqui: o link vale 24 h (ou até a equipe encerrar), mesmo que todo mundo saia. */
async function processarFimDeReuniao(db: SupabaseClient, meetingId: string | undefined, motivo: string | undefined): Promise<void> {
  if (!meetingId) return;
  const { data } = await db
    .from("sessoes")
    .select("id, status, inicio, agendas(duracao_min)")
    .eq("rtk_meeting_id", meetingId)
    .maybeSingle();
  const sessao = data as { id: string; status?: string; inicio?: string; agendas?: unknown } | null;
  if (!sessao || sessao.status !== "ao_vivo") return;
  if (motivo !== "HOST_ENDED_MEETING") {
    const ag = (Array.isArray(sessao.agendas) ? sessao.agendas[0] : sessao.agendas) as { duracao_min?: number } | null | undefined;
    if (!sessao.inicio || typeof ag?.duracao_min !== "number") return;
    if (Date.now() < fimProgramado(new Date(sessao.inicio), ag.duracao_min).getTime()) return;
  }
  const { error } = await db.from("sessoes").update({ status: "encerrada" }).eq("id", sessao.id);
  if (error) throw new Error("Não foi possível encerrar a sessão.");
}

/** Processa um evento já autenticado (assinatura válida) e deduplicado (primeira vez que esse `rtk-uuid`
 *  aparece). `meeting.transcript` (transcrição completa da sessão transcrita) vai pra `receberTranscricao`. Eventos fora de `recording.statusUpdate`/`meeting.ended`/`meeting.participant{Joined,Left}`/`meeting.transcript` não
 *  fazem nada aqui — a presença deles em `webhook_recebidos` já foi gravada por quem chamou, antes de chegar
 *  nesta função. Presença (`registrarEntrada`/`registrarSaida`) usa seu próprio `dbAdmin()`, não o `db` recebido
 *  aqui (que só serve pros eventos de gravação/fim de reunião). */
export async function processarEvento(db: SupabaseClient, evento: string, payload: Record<string, unknown>): Promise<void> {
  if (evento === "recording.statusUpdate") {
    await processarGravacao(db, payload.recording as PayloadGravacao | undefined, payload);
  } else if (evento === "meeting.ended") {
    const meeting = payload.meeting as { reason?: string } | undefined;
    const motivo = (payload as { reason?: string }).reason ?? meeting?.reason;
    const meetingId = resolverMeetingId(payload);
    // `processarFimDeReuniao` não faz nada sem id — loga aqui pra guardar as chaves do payload (nunca o corpo
    // inteiro), e a rota ainda devolve 200.
    if (!meetingId) console.error("[webhook rtk] meeting.ended sem id da meeting", Object.keys(payload));
    await processarFimDeReuniao(db, meetingId, motivo);
  } else if (evento === "meeting.participantJoined") {
    await registrarEntrada(payload);
  } else if (evento === "meeting.participantLeft") {
    await registrarSaida(payload);
  } else if (evento === "meeting.transcript") {
    await receberTranscricao(payload);
  }
}
