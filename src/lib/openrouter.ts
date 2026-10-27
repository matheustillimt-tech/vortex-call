import "server-only";
import { siteUrl } from "./env";

export type CfgOpenRouter = { openrouterKey: string; modelo: string };
/** `prazoMs`: tempo total pra resposta, somando todos os modelos (cada um pega o que sobrou, até o limite dele).
 *  Sem `prazoMs`, cada modelo tem o tempo limite padrão. */
export type PedidoJson = { sistema: string; usuario: string; maxTokens?: number; temperatura?: number; prazoMs?: number };

const API = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 30_000;
const TIMEOUT_RESERVA_MS = 20_000;

/** `OPENROUTER_TEXT_MODEL` aceita um modelo ou vários separados por vírgula: o primeiro é o principal, os outros
 *  reserva. */
export function modelosDe(cfg: CfgOpenRouter): string[] {
  return cfg.modelo.split(",").map((m) => m.trim()).filter(Boolean);
}

/** Pede uma resposta em JSON (`response_format: json_object`) e devolve o objeto. Se um modelo falhar (HTTP,
 *  timeout, JSON inválido), tenta o próximo da lista. Nada deu certo → `Error("A IA não respondeu.")`, sem detalhe
 *  da chave nem do motivo. `f` é injetável para os testes. */
export async function completarJson(pedido: PedidoJson, cfg: CfgOpenRouter, f: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const modelos = modelosDe(cfg);
  const timeout = modelos.length > 1 ? TIMEOUT_RESERVA_MS : TIMEOUT_MS;
  const fim = pedido.prazoMs !== undefined ? Date.now() + pedido.prazoMs : null;
  for (const modelo of modelos) {
    const tempo = fim === null ? timeout : Math.min(timeout, fim - Date.now());
    if (tempo <= 0) break;
    try {
      return await tentar(pedido, cfg.openrouterKey, modelo, tempo, f);
    } catch (e) {
      console.warn(`[openrouter] modelo ${modelo} falhou: ${motivoFalha(e)}`);
    }
  }
  throw new Error("A IA não respondeu.");
}

/** Só o essencial pro log: status HTTP ou "timeout". Nunca a chave, o prompt nem o corpo da resposta. */
function motivoFalha(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "AbortError") return "timeout";
    const http = /^HTTP (\d+)$/.exec(e.message);
    if (http) return `HTTP ${http[1]}`;
  }
  return "erro";
}

async function tentar(pedido: PedidoJson, chave: string, modelo: string, timeoutMs: number, f: typeof fetch): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await f(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chave}`,
        "content-type": "application/json",
        "HTTP-Referer": siteUrl(),
        "X-Title": "Vórtex Call",
      },
      body: JSON.stringify({
        model: modelo,
        response_format: { type: "json_object" },
        max_tokens: pedido.maxTokens,
        temperature: pedido.temperatura,
        messages: [
          { role: "system", content: pedido.sistema },
          { role: "user", content: pedido.usuario },
        ],
      }),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const conteudo = d.choices?.[0]?.message?.content;
    if (!conteudo) throw new Error("sem conteúdo");
    return extrairJson(conteudo);
  } finally {
    clearTimeout(timer);
  }
}

/** Alguns modelos devolvem o JSON com cerca ``` ou com texto antes: tenta o parse direto e, se falhar, pega o
 *  primeiro `{...}` balanceado. */
function extrairJson(conteudo: string): Record<string, unknown> {
  try {
    return JSON.parse(conteudo) as Record<string, unknown>;
  } catch {
    const inicio = conteudo.indexOf("{");
    if (inicio === -1) throw new Error("sem JSON");
    let profundidade = 0;
    for (let i = inicio; i < conteudo.length; i++) {
      if (conteudo[i] === "{") profundidade++;
      else if (conteudo[i] === "}") {
        profundidade--;
        if (profundidade === 0) return JSON.parse(conteudo.slice(inicio, i + 1)) as Record<string, unknown>;
      }
    }
    throw new Error("JSON incompleto");
  }
}
