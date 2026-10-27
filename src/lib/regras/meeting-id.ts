/** O formato exato de `meeting.id` varia entre os eventos do RealtimeKit (só `recording.statusUpdate` tem
 *  certeza documentada de um `meeting.id` no nível raiz). Tenta `meeting.id`, depois `meetingId` no nível raiz,
 *  depois `meeting.meetingId`. Não loga nem lança: quem chama decide a mensagem quando o id vem `undefined`.
 *  Usado por `meeting.ended` (webhook-rtk) e pela presença (`participantJoined`/`participantLeft`, presenca.ts). */
export function resolverMeetingId(payload: Record<string, unknown>): string | undefined {
  const meeting = payload.meeting as { id?: string; meetingId?: string } | undefined;
  return meeting?.id ?? (payload as { meetingId?: string }).meetingId ?? meeting?.meetingId;
}
