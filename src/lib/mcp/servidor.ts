import "server-only";
import pacote from "@/package.json";
import { siteUrl } from "../env";
import { autenticarChave, type ChaveAutenticada } from "./auth";
import { acharFerramenta, chamarFerramenta, listaDeFerramentas } from "./ferramentas";

/**
 * Servidor MCP do Vórtex Call: transporte Streamable HTTP SEM estado (sem `Mcp-Session-Id`, sem SSE).
 * `POST /api/mcp` recebe uma mensagem JSON-RPC 2.0 (ou um lote de até 20) e responde JSON; só
 * notificações → 202 sem corpo. Autentica pela chave `vc_…` (Integrações); cada requisição HTTP conta 1 chamada no
 * limite por minuto (a contagem é feita em `autenticarChave`). Nunca loga a chave nem o header Authorization.
 */

export const VERSAO_PROTOCOLO = "2025-06-18";
export const VERSOES_SUPORTADAS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

const MAXIMO_CORPO = 1024 * 1024;
export const MAXIMO_LOTE = 20;

const ERRO = { parse: -32700, requisicaoInvalida: -32600, metodo: -32601, parametros: -32602, interno: -32603 } as const;

export const INSTRUCOES =
  "Vórtex Call é a videochamada da empresa (agenda de sessões coletivas, sala, ficha do lead). listar_*, ver_* e link_* só leem. " +
  "criar_sessao, cancelar_sessao e criar_reuniao mudam dados: confirme com o usuário antes. " +
  "cancelar_sessao avisa o total de inscritos e exige confirmar=true. Datas em horário de Brasília.";

type Id = string | number | null;
type RespostaRpc = { jsonrpc: "2.0"; id: Id; result: unknown } | { jsonrpc: "2.0"; id: Id; error: { code: number; message: string } };

const SEM_CACHE = { "cache-control": "no-store" };

const resultado = (id: Id, result: unknown): RespostaRpc => ({ jsonrpc: "2.0", id, result });
const falha = (id: Id, code: number, message: string): RespostaRpc => ({ jsonrpc: "2.0", id, error: { code, message } });
const json = (corpo: unknown, status = 200, cabecalhos: Record<string, string> = {}) =>
  Response.json(corpo, { status, headers: { ...SEM_CACHE, ...cabecalhos } });

const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ehIdValido = (v: unknown): v is string | number => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

/** Origem do próprio site. Navegador de outra origem (DNS rebinding) → 403; sem `Origin` (CLI, servidor) passa. */
function origemPermitida(req: Request): boolean {
  const origem = req.headers.get("origin");
  if (origem === null) return true;
  try {
    return origem === new URL(siteUrl()).origin;
  } catch {
    return false;
  }
}

async function tratarMensagem(m: unknown, chave: ChaveAutenticada): Promise<RespostaRpc | null> {
  if (!ehObjeto(m) || m.jsonrpc !== "2.0") return falha(ehObjeto(m) && ehIdValido(m.id) ? m.id : null, ERRO.requisicaoInvalida, "Requisição JSON-RPC inválida.");
  // Resposta do cliente (não fazemos pedidos) ou notificação: aceita e não responde.
  if (typeof m.method !== "string") {
    if ("result" in m || "error" in m) return null;
    return falha(ehIdValido(m.id) ? m.id : null, ERRO.requisicaoInvalida, "Requisição JSON-RPC inválida.");
  }
  if (!("id" in m)) return null;
  if (!ehIdValido(m.id)) return falha(null, ERRO.requisicaoInvalida, "Requisição JSON-RPC inválida: id deve ser texto ou número.");
  const id = m.id;
  const params = m.params === undefined ? {} : m.params;
  if (!ehObjeto(params)) return falha(id, ERRO.parametros, "params deve ser um objeto.");

  switch (m.method) {
    case "initialize": {
      const pedida = params.protocolVersion;
      const versao = typeof pedida === "string" && (VERSOES_SUPORTADAS as readonly string[]).includes(pedida) ? pedida : VERSAO_PROTOCOLO;
      return resultado(id, { protocolVersion: versao, capabilities: { tools: {} }, serverInfo: { name: "vortex-call", version: pacote.version }, instructions: INSTRUCOES });
    }
    case "ping":
      return resultado(id, {});
    case "tools/list":
      return resultado(id, { tools: listaDeFerramentas() });
    case "tools/call": {
      if (typeof params.name !== "string") return falha(id, ERRO.parametros, "Informe o nome da ferramenta (params.name).");
      const f = acharFerramenta(params.name);
      if (!f) return falha(id, ERRO.parametros, `Ferramenta desconhecida: ${params.name.slice(0, 80)}`);
      const args = params.arguments === undefined ? {} : params.arguments;
      if (!ehObjeto(args)) return falha(id, ERRO.parametros, "arguments deve ser um objeto.");
      try {
        return resultado(id, await chamarFerramenta(f, chave, args));
      } catch (e) {
        console.error(`[mcp] ${f.name} falhou:`, e instanceof Error ? e.message : "erro");
        return resultado(id, { content: [{ type: "text", text: "Não deu para concluir a chamada. Tente de novo." }], isError: true });
      }
    }
    default:
      return falha(id, ERRO.metodo, `Método não encontrado: ${m.method.slice(0, 80)}`);
  }
}

/** POST /api/mcp. Ordem: origem → chave (conta 1 chamada) → tamanho → JSON → lote → versão → mensagens em ordem. */
export async function tratarPostMcp(req: Request): Promise<Response> {
  if (!origemPermitida(req)) return json(falha(null, ERRO.requisicaoInvalida, "Origem não permitida."), 403);

  const a = await autenticarChave(req, "rpc");
  if (a instanceof Response) return a;

  const tamanhoAnunciado = Number(req.headers.get("content-length"));
  if (Number.isFinite(tamanhoAnunciado) && tamanhoAnunciado > MAXIMO_CORPO) return json(falha(null, ERRO.requisicaoInvalida, "Corpo grande demais."), 413);
  const textoCorpo = await req.text();
  if (new TextEncoder().encode(textoCorpo).length > MAXIMO_CORPO) return json(falha(null, ERRO.requisicaoInvalida, "Corpo grande demais."), 413);

  let corpo: unknown;
  try {
    corpo = JSON.parse(textoCorpo);
  } catch {
    return json(falha(null, ERRO.parse, "JSON inválido."), 400);
  }

  const lote = Array.isArray(corpo);
  const mensagens: unknown[] = lote ? (corpo as unknown[]) : [corpo];
  if (!mensagens.length) return json(falha(null, ERRO.requisicaoInvalida, "Lote vazio."), 400);
  if (mensagens.length > MAXIMO_LOTE) return json(falha(null, ERRO.requisicaoInvalida, `Lote grande demais (máximo ${MAXIMO_LOTE}).`), 400);

  const versaoHeader = req.headers.get("mcp-protocol-version");
  const temInitialize = mensagens.some((m) => ehObjeto(m) && m.method === "initialize");
  if (versaoHeader && !temInitialize && !(VERSOES_SUPORTADAS as readonly string[]).includes(versaoHeader))
    return json(falha(null, ERRO.requisicaoInvalida, `Versão do protocolo MCP não suportada: ${versaoHeader.slice(0, 40)}. Use ${VERSAO_PROTOCOLO}.`), 400);

  const respostas: RespostaRpc[] = [];
  for (const m of mensagens) {
    const r = await tratarMensagem(m, a.chave);
    if (r) respostas.push(r);
  }
  if (!respostas.length) return new Response(null, { status: 202, headers: SEM_CACHE });
  return json(lote ? respostas : respostas[0]);
}

/** GET/DELETE: sem SSE nem sessão neste servidor. */
export function metodoNaoPermitido(): Response {
  return json(falha(null, ERRO.requisicaoInvalida, "Use POST: este servidor MCP não abre SSE nem guarda sessão."), 405, { allow: "POST" });
}
