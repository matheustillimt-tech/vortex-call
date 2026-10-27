import "server-only";
import { resolverMeetingId } from "./regras/meeting-id";
import { dbAdmin } from "./supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DadosParticipante = { peerId?: string; customParticipantId?: string; joinedAt?: string; leftAt?: string };

/** `participant.peerId/customParticipantId/joinedAt/leftAt`, com fallback pros mesmos campos no nível raiz do
 *  payload (como o resto do webhook do RealtimeKit). */
function extrairParticipante(payload: Record<string, unknown>): DadosParticipante {
  const participant = payload.participant as Record<string, unknown> | undefined;
  const campo = (nome: string) => (participant?.[nome] ?? payload[nome]) as string | undefined;
  return {
    peerId: campo("peerId"),
    customParticipantId: campo("customParticipantId"),
    joinedAt: campo("joinedAt"),
    leftAt: campo("leftAt"),
  };
}

/** Só convidado inscrito (custom id = uuid da inscrição) gera presença; equipe (`membro:`), visitante
 *  (`visitante:`) e qualquer outro formato ficam de fora. */
function idDeInscricao(customParticipantId: string | undefined): string | null {
  return customParticipantId && UUID.test(customParticipantId) ? customParticipantId.toLowerCase() : null;
}

async function sessaoPelaMeeting(meetingId: string | undefined): Promise<string | null> {
  if (!meetingId) return null;
  const db = dbAdmin();
  const { data } = await db.from("sessoes").select("id").eq("rtk_meeting_id", meetingId).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** Confere que o custom id é mesmo uma inscrição daquela sessão (não de outra, nem inexistente). */
async function sessaoDaInscricaoValida(inscricaoId: string, sessaoId: string): Promise<boolean> {
  const db = dbAdmin();
  const { data } = await db.from("inscricoes").select("id").eq("id", inscricaoId).eq("sessao_id", sessaoId).maybeSingle();
  return Boolean((data as { id?: string } | null)?.id);
}

function logPayloadMalformado(payload: Record<string, unknown>): void {
  console.error("[webhook rtk] presença sem peerId/customParticipantId", Object.keys(payload));
}

/** Resolve o id da meeting com a mesma tolerância de formato do `meeting.ended` (`resolverMeetingId`); loga e
 *  devolve `null` quando nenhum formato dá id — quem chama já sabe, nesse ponto, que o custom id é de um
 *  convidado inscrito de verdade, então vale logar pra investigar (nunca o corpo inteiro do payload). */
function meetingIdOuLoga(payload: Record<string, unknown>): string | undefined {
  const meetingId = resolverMeetingId(payload);
  if (!meetingId) console.error("[webhook rtk] presença sem id da meeting", Object.keys(payload));
  return meetingId;
}

/** `meeting.participantJoined`: grava a presença do convidado (inscrito) que entrou na sala. Reconexão (mesmo
 *  `peerId`, ex.: F5 na página) não duplica — `on conflict (peer_id) do nothing`. Equipe (`membro:`), visitante
 *  (`visitante:`) e reunião instantânea (sem sessão achada pela meeting) são ignorados, sem erro. Payload sem os
 *  campos esperados só loga e sai (não lança: a Cloudflare não deve reenviar pra sempre por isso). */
export async function registrarEntrada(payload: Record<string, unknown>): Promise<void> {
  const dados = extrairParticipante(payload);
  if (!dados.peerId || !dados.customParticipantId || !dados.joinedAt) {
    logPayloadMalformado(payload);
    return;
  }
  const inscricaoId = idDeInscricao(dados.customParticipantId);
  if (!inscricaoId) return;
  const meetingId = meetingIdOuLoga(payload);
  if (!meetingId) return;
  const sessaoId = await sessaoPelaMeeting(meetingId);
  if (!sessaoId || !(await sessaoDaInscricaoValida(inscricaoId, sessaoId))) return;

  const db = dbAdmin();
  const { error } = await db
    .from("presencas")
    .upsert(
      { sessao_id: sessaoId, inscricao_id: inscricaoId, peer_id: dados.peerId, entrou_em: dados.joinedAt },
      { onConflict: "peer_id", ignoreDuplicates: true },
    );
  if (error) throw new Error("Não foi possível salvar a entrada na sala.");
}

/** `meeting.participantLeft`: fecha a presença aberta daquele `peerId` (`saiu_em` ainda nulo). Se o
 *  `participantJoined` dela se perdeu (nenhuma linha pra fechar), insere a presença já fechada — desde que o
 *  custom id seja uma inscrição válida daquela sessão. Payload sem os campos esperados só loga e sai. */
export async function registrarSaida(payload: Record<string, unknown>): Promise<void> {
  const dados = extrairParticipante(payload);
  if (!dados.peerId || !dados.leftAt) {
    logPayloadMalformado(payload);
    return;
  }

  const db = dbAdmin();
  const { data, error: erroUpdate } = await db
    .from("presencas")
    .update({ saiu_em: dados.leftAt })
    .eq("peer_id", dados.peerId)
    .is("saiu_em", null)
    .select("id");
  if (erroUpdate) throw new Error("Não foi possível salvar a saída da sala.");
  if ((data as unknown[] | null)?.length) return;

  // participantJoined perdido: só insere se der pra confirmar que é mesmo um convidado inscrito nessa sessão.
  const inscricaoId = idDeInscricao(dados.customParticipantId);
  if (!inscricaoId || !dados.joinedAt) return;
  const meetingId = meetingIdOuLoga(payload);
  if (!meetingId) return;
  const sessaoId = await sessaoPelaMeeting(meetingId);
  if (!sessaoId || !(await sessaoDaInscricaoValida(inscricaoId, sessaoId))) return;

  const { error } = await db
    .from("presencas")
    .upsert(
      { sessao_id: sessaoId, inscricao_id: inscricaoId, peer_id: dados.peerId, entrou_em: dados.joinedAt, saiu_em: dados.leftAt },
      { onConflict: "peer_id", ignoreDuplicates: true },
    );
  if (error) throw new Error("Não foi possível salvar a saída da sala.");
}
