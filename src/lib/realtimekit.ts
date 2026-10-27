import "server-only";
import { env } from "./env";

export type MeetingRtk = { id: string };
export type ParticipanteRtk = { id: string; token: string };

export class ErroRtk extends Error {
  constructor(public status: number, public corpo: unknown) {
    super(`RealtimeKit respondeu ${status}`);
  }
}

function base(): string {
  return `https://api.cloudflare.com/client/v4/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}/realtime/kit/${env("REALTIMEKIT_APP_ID")}`;
}

export async function rtk<T>(metodo: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", caminho: string, corpo?: unknown): Promise<T> {
  const r = await fetch(`${base()}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${env("CLOUDFLARE_API_TOKEN")}`, "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    cache: "no-store",
  });
  const json = (await r.json().catch(() => null)) as { data?: T } | null;
  if (!r.ok) {
    // Só o método, o caminho (sem a conta) e a mensagem da Cloudflare: nunca o token nem o corpo enviado.
    if (r.status !== 404) console.error("[rtk]", metodo, caminho.split("?")[0], r.status, JSON.stringify((json as { error?: unknown } | null)?.error ?? null).slice(0, 500));
    throw new ErroRtk(r.status, json);
  }
  return (json?.data ?? (json as T)) as T;
}

/** Palavras que a transcrição deve reconhecer (nome da empresa, dos produtos e da equipe), lidas de
 *  `TRANSCRICAO_PALAVRAS` (separadas por vírgula, até 50). Sem a variável, a transcrição vai sem lista. */
export function palavrasTranscricao(): string[] {
  return (process.env.TRANSCRICAO_PALAVRAS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 50);
}

/** Corpo do `POST /meetings`. Meeting nova nunca grava sozinha (`record_on_start: false`): a gravação começa pela
 *  API (`src/lib/gravacao.ts`), que é onde dá para mandar o arquivo pro R2 da empresa. Com `transcrever`, a meeting
 *  nasce com a transcrição em português (ao vivo, pra quem entra com preset `_transcricao`) e a transcrição completa
 *  no fim (`transcribe_on_end`, webhook `meeting.transcript`). O resumo da Cloudflare fica desligado: o resumo é
 *  nosso. */
export function corpoMeeting(o: { titulo: string; transcrever?: boolean }): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    title: o.titulo, record_on_start: false, persist_chat: true, session_keep_alive_time_in_secs: 600,
  };
  if (o.transcrever) {
    corpo.transcribe_on_end = true;
    corpo.summarize_on_end = false;
    // "pt", não "pt-BR": com `transcribe_on_end`, a Cloudflare valida o idioma pela lista do Whisper (só "pt"; o
    // "pt-BR" dá 400 "Invalid language … for post-meeting transcription", conferido em 26/10/2026). O Nova-3 do ao
    // vivo também aceita "pt".
    const palavras = palavrasTranscricao();
    corpo.ai_config = { transcription: { language: "pt", ...(palavras.length ? { keywords: palavras } : {}), profanity_filter: false } };
  }
  return corpo;
}

export async function criarMeeting(o: { titulo: string; transcrever?: boolean }): Promise<MeetingRtk> {
  const m = await rtk<{ id: string }>("POST", "/meetings", corpoMeeting(o));
  return { id: m.id };
}

export async function adicionarParticipante(meetingId: string, o: { nome: string; preset: string; customId: string }): Promise<ParticipanteRtk> {
  const p = await rtk<{ id: string; token: string }>("POST", `/meetings/${meetingId}/participants`, {
    name: o.nome, preset_name: o.preset, custom_participant_id: o.customId,
  });
  return { id: p.id, token: p.token };
}

/** Chamadas de "limpeza" (kick, excluir participante, desativar meeting): qualquer 4xx é tolerado — 404 é o caso
 *  normal (sem sessão ativa, participante já apagado) e fica em silêncio; os demais 4xx (400, 409, 422...) só
 *  viram aviso no console, porque nunca podem impedir alguém de entrar ou a call de encerrar. Só 5xx e falha de
 *  rede sobem como erro. */
async function tolerar4xx(p: Promise<unknown>, rotulo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroRtk && e.status >= 400 && e.status < 500) {
      if (e.status !== 404) console.warn(rotulo, e.status);
      return;
    }
    throw e;
  }
}

export function expulsar(meetingId: string, customIds: string[]): Promise<void> {
  return tolerar4xx(rtk("POST", `/meetings/${meetingId}/active-session/kick`, { custom_participant_ids: customIds }), "[rtk] kick ignorado");
}

export function expulsarTodos(meetingId: string): Promise<void> {
  return tolerar4xx(rtk("POST", `/meetings/${meetingId}/active-session/kick-all`, {}), "[rtk] kick ignorado");
}

/** Apaga o participante: revoga todos os tokens dele (o passe antigo para de funcionar). */
export function excluirParticipante(meetingId: string, participantId: string): Promise<void> {
  return tolerar4xx(rtk("DELETE", `/meetings/${meetingId}/participants/${participantId}`), "[rtk] exclusão de participante ignorada");
}

/** Marca a meeting como INACTIVE: ninguém entra nem inicia sessão nova, mesmo com token antigo. */
export function desativarMeeting(meetingId: string): Promise<void> {
  return tolerar4xx(rtk("PATCH", `/meetings/${meetingId}`, { status: "INACTIVE" }), "[rtk] desativação da meeting ignorada");
}

/** Link de download de uma gravação, pedido na hora (o link salvo no banco expira). Gravação apagada/inexistente
 *  (404) ou ainda sem arquivo → `null`. Outros erros sobem como `ErroRtk`. */
export async function linkDaGravacao(recordingId: string): Promise<{ url: string; expira: string | null } | null> {
  try {
    const g = await rtk<{ download_url?: string | null; download_url_expiry?: string | null }>("GET", `/recordings/${encodeURIComponent(recordingId)}`);
    return g?.download_url ? { url: g.download_url, expira: g.download_url_expiry ?? null } : null;
  } catch (e) {
    if (e instanceof ErroRtk && e.status === 404) return null;
    throw e;
  }
}
