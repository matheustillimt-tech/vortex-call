import "server-only";
import { adicionarParticipante, desativarMeeting, excluirParticipante, expulsar, expulsarTodos, type ParticipanteRtk } from "./realtimekit";
import { dbAdmin } from "./supabase/admin";

/** Cria o participante novo da pessoa e apaga o anterior (se houver) na mesma meeting: apagar revoga os tokens,
 *  então um passe antigo aberto em outra aba não consegue mais entrar. Ordem: lê o anterior, adiciona o novo,
 *  guarda o novo em `passes_rtk`, só então apaga o anterior.
 *  Corrida aceita: dois pedidos simultâneos da mesma pessoa podem ler o mesmo "anterior" e ambos criarem um
 *  participante; o upsert deixa só um registrado e o outro sobra com token válido. Não dá pra serializar com
 *  `pg_advisory_xact_lock` porque a trava não atravessa as chamadas HTTP (Supabase REST + RealtimeKit); o kick
 *  feito antes de cada passe e o próximo passe da pessoa limpam esse caso. */
export async function novoParticipante(meetingId: string, o: { nome: string; preset: string; customId: string }): Promise<ParticipanteRtk> {
  const db = dbAdmin();
  const { data: anterior } = await db
    .from("passes_rtk")
    .select("participant_id")
    .eq("custom_id", o.customId)
    .eq("meeting_id", meetingId)
    .maybeSingle();
  const p = await adicionarParticipante(meetingId, o);
  const { error } = await db
    .from("passes_rtk")
    .upsert(
      { custom_id: o.customId, meeting_id: meetingId, participant_id: p.id, created_at: new Date().toISOString() },
      { onConflict: "custom_id,meeting_id" },
    );
  if (error) throw new Error("Não foi possível guardar o passe.");
  const idAnterior = (anterior as { participant_id?: string } | null)?.participant_id;
  if (idAnterior && idAnterior !== p.id) await excluirParticipante(meetingId, idAnterior);
  return p;
}

/** Uma presença por pessoa: tira da sala quem já está com o mesmo `customId` (outra aba/aparelho) e só então cria
 *  o participante novo (que apaga o anterior). */
export async function participanteUnico(meetingId: string, o: { nome: string; preset: string; customId: string }): Promise<ParticipanteRtk> {
  await expulsar(meetingId, [o.customId]);
  return novoParticipante(meetingId, o);
}

/** Tira todo mundo da sala e desativa a meeting (tokens antigos param de funcionar). */
export async function fecharMeeting(meetingId: string): Promise<void> {
  await expulsarTodos(meetingId);
  await desativarMeeting(meetingId);
}
