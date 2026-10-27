import "server-only";
import { env } from "./env";
import { r2Config } from "./r2";
import { ErroRtk, rtk } from "./realtimekit";
import { dbAdmin } from "./supabase/admin";

/** Pasta das gravações no bucket R2 (`storage_config.path`). */
export const PASTA_GRAVACOES = "gravacoes";

export type AlvoGravacao = "sessao" | "reuniao";

/** Prefixo ÚNICO de cada gravação, escolhido quando o Vórtex Call começa a gravar: `s_<uuid sem hífens>_<ms>`
 *  (sessão) ou `r_…_<ms>` (reunião). `file_name_prefix` aceita só letras, números e `_`; o RealtimeKit grava o
 *  arquivo como `{prefixo}_{sala}_{timestamp}`, então o prefixo aponta pra um arquivo só (nada de adivinhar entre
 *  várias gravações da mesma sessão). */
export function prefixoGravacao(tipo: AlvoGravacao, id: string, agoraMs: number = Date.now()): string {
  return `${tipo === "sessao" ? "s" : "r"}_${id.replace(/-/g, "").toLowerCase()}_${agoraMs}`;
}

/** Prefixo da chave no bucket pra achar o arquivo (`gravacoes/{prefixo}`). */
export function prefixoNoBucket(prefixo: string): string {
  return `${PASTA_GRAVACOES}/${prefixo}`;
}

/** Começa a gravar pela API (`POST /recordings`). Com R2 configurado o arquivo vai pro bucket da empresa
 *  (`storage_config` tipo `cloudflare`); sem R2 fica no storage da Cloudflare (7 dias). Devolve o id da gravação. */
export async function iniciarGravacao(meetingId: string, prefixo: string): Promise<string> {
  const r2 = r2Config();
  const corpo: Record<string, unknown> = { meeting_id: meetingId, file_name_prefix: prefixo };
  if (r2) {
    corpo.storage_config = {
      type: "cloudflare",
      access_key: r2.accessKeyId,
      secret: r2.secretAccessKey,
      bucket: r2.bucket,
      path: PASTA_GRAVACOES,
      account_id: env("CLOUDFLARE_ACCOUNT_ID"),
    };
  }
  const g = await rtk<{ id: string }>("POST", "/recordings", corpo);
  return g.id;
}

/** Guarda o prefixo da gravação recém-começada. Se o webhook chegou antes e a linha já existe (23505), só
 *  completa `r2_prefixo` (nunca mexe no status que o webhook gravou). */
async function registrarGravacao(alvo: { tipo: AlvoGravacao; id: string }, recordingId: string, prefixo: string): Promise<void> {
  const db = dbAdmin();
  const { error } = await db.from("gravacoes").insert({
    rtk_recording_id: recordingId,
    sessao_id: alvo.tipo === "sessao" ? alvo.id : null,
    reuniao_id: alvo.tipo === "reuniao" ? alvo.id : null,
    status: "RECORDING",
    r2_prefixo: prefixo,
  });
  if (!error) return;
  if ((error as { code?: string }).code !== "23505") throw new Error("Não foi possível registrar a gravação.");
  const { error: erroUpdate } = await db.from("gravacoes").update({ r2_prefixo: prefixo }).eq("rtk_recording_id", recordingId);
  if (erroUpdate) throw new Error("Não foi possível registrar a gravação.");
}

/** Começa a gravar a sessão/reunião com um prefixo único e registra a gravação (com o prefixo) no banco. Erro do
 *  RealtimeKit sobe como `ErroRtk`; erro ao registrar sobe também (a gravação já começou: o webhook cria a linha,
 *  mas sem prefixo o arquivo não é ligado ao R2). */
export async function comecarGravacao(alvo: { tipo: AlvoGravacao; id: string }, meetingId: string): Promise<string> {
  const prefixo = prefixoGravacao(alvo.tipo, alvo.id);
  const recordingId = await iniciarGravacao(meetingId, prefixo);
  await registrarGravacao(alvo, recordingId, prefixo);
  return recordingId;
}

/** Para a gravação ativa da meeting (`GET /recordings/active-recording/{meeting}` + `PUT /recordings/{id}`
 *  `{action: "stop"}`). Nada gravando (404 ou sem id) → `false`. */
export async function pararGravacao(meetingId: string): Promise<boolean> {
  let ativa: { id?: string } | null;
  try {
    ativa = await rtk<{ id?: string } | null>("GET", `/recordings/active-recording/${encodeURIComponent(meetingId)}`);
  } catch (e) {
    if (e instanceof ErroRtk && e.status === 404) return false;
    throw e;
  }
  if (!ativa?.id) return false;
  await rtk("PUT", `/recordings/${encodeURIComponent(ativa.id)}`, { action: "stop" });
  return true;
}

const esperarMs = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/** Esperas antes de cada tentativa de `gravarAoAbrir` (somam 50 s, dentro do `maxDuration` da rota). */
export const ESPERAS_GRAVAR_AO_ABRIR_MS = [3000, 7000, 15000, 25000];

/** Vale tentar de novo? 5xx, 404 (meeting ainda sem sessão ativa) e falha de rede (fetch lança fora do `ErroRtk`).
 *  401/403/409/422 e outros 4xx param na hora. */
function valeTentarDeNovo(e: unknown): boolean {
  if (e instanceof ErroRtk) return e.status >= 500 || e.status === 404;
  return e instanceof TypeError;
}

/** Gravação automática (agenda com `grava_sozinha`) quando o anfitrião abre a sessão. Roda no `after()`, logo
 *  depois do passe: o anfitrião ainda está entrando na sala, e a doc não diz se a API aceita gravar uma meeting sem
 *  ninguém dentro. Por isso espera um pouco e tenta de novo (só o início no RealtimeKit; o registro no banco roda
 *  uma vez). Nunca lança: falha só vai pro log (o anfitrião ainda tem o botão Gravar). Devolve o id ou `null`. */
export async function gravarAoAbrir(
  alvo: { tipo: AlvoGravacao; id: string },
  meetingId: string,
  esperas: number[] = ESPERAS_GRAVAR_AO_ABRIR_MS,
  esperar: (ms: number) => Promise<void> = esperarMs,
): Promise<string | null> {
  let ultimo: unknown = null;
  for (const ms of esperas) {
    await esperar(ms);
    const prefixo = prefixoGravacao(alvo.tipo, alvo.id);
    let recordingId: string;
    try {
      recordingId = await iniciarGravacao(meetingId, prefixo);
    } catch (e) {
      ultimo = e;
      if (!valeTentarDeNovo(e)) break;
      continue;
    }
    try {
      await registrarGravacao(alvo, recordingId, prefixo);
    } catch (e) {
      console.error("[gravacao] gravando, mas sem registrar o prefixo", recordingId, e instanceof Error ? e.message : "erro");
    }
    return recordingId;
  }
  console.error("[gravacao] não começou a gravar sozinha", meetingId, ultimo instanceof ErroRtk ? ultimo.status : ultimo instanceof Error ? ultimo.message : "erro");
  return null;
}
