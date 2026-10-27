import "server-only";
import { dbAdmin } from "../supabase/admin";
import { FORMATO_CHAVE, hashDaChave, type Permissao } from "./chaves";

/** Chave que autenticou a chamada (API REST `/api/v1/*` ou MCP `/api/mcp`). `usuarioId` é quem criou a chave: as
 *  alterações feitas pela API/MCP entram no histórico de ações no nome dessa pessoa. */
export type ChaveAutenticada = { id: string; nome: string; permissao: Permissao; usuarioId: string | null };

export const LIMITE_POR_MINUTO = 120;

export const ERROS_AUTH = {
  naoAutenticado: "Chave de acesso ausente ou inválida.",
  limite: `Limite de ${LIMITE_POR_MINUTO} chamadas por minuto atingido. Tente de novo em instantes.`,
  indisponivel: "Não deu para conferir a chave agora. Tente de novo.",
} as const;

const SEM_CACHE = { "cache-control": "no-store" };

/** REST: `{ erro }`. RPC (MCP): JSON-RPC 2.0 com `id: null`. */
function erro(formato: "rest" | "rpc", status: number, mensagem: string, cabecalhos: Record<string, string> = {}) {
  const corpo = formato === "rest" ? { erro: mensagem } : { jsonrpc: "2.0", id: null, error: { code: -32001, message: mensagem } };
  return Response.json(corpo, { status, headers: { ...SEM_CACHE, ...cabecalhos } });
}

/** Lê `Authorization: Bearer vc_…`. Nunca loga a chave nem o header. */
function chaveDoHeader(req: Request): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  return m && FORMATO_CHAVE.test(m[1]) ? m[1] : null;
}

/** Soma 1 chamada no minuto da chave. Erro do banco → `indisponivel` (fecha: sem contador, sem chamada). */
export async function registrarUso(chaveId: string): Promise<"ok" | "limite" | "indisponivel"> {
  const { data, error } = await dbAdmin().rpc("api_registrar_uso", { p_chave: chaveId });
  if (error) return "indisponivel";
  return Number(data) > LIMITE_POR_MINUTO ? "limite" : "ok";
}

/** Autentica a chamada (API REST ou MCP) pela chave: ausente, mal formada ou revogada → 401; acima do limite por
 *  minuto → 429; erro ao conferir no banco → 503. A chave de quem foi desativado ou deixou de ser admin para de
 *  valer. Devolve a chave ou a `Response` de erro pronta, já no formato pedido (`rest` ou `rpc`). */
export async function autenticarChave(req: Request, formato: "rest" | "rpc"): Promise<{ chave: ChaveAutenticada } | Response> {
  const cabecalhoAuth = { "www-authenticate": 'Bearer realm="vortex-call"' };
  const texto = chaveDoHeader(req);
  if (!texto) return erro(formato, 401, ERROS_AUTH.naoAutenticado, cabecalhoAuth);
  const { data, error } = await dbAdmin()
    .from("chaves_api")
    .select("id, nome, permissao, criada_por, revogada_em, usuarios(ativo, papel)")
    .eq("hash", hashDaChave(texto))
    .maybeSingle();
  if (error) return erro(formato, 503, ERROS_AUTH.indisponivel);
  const linha = data as {
    id: string;
    nome: string;
    permissao: Permissao;
    criada_por: string | null;
    revogada_em: string | null;
    usuarios: { ativo: boolean; papel: string } | null;
  } | null;
  if (!linha || linha.revogada_em) return erro(formato, 401, ERROS_AUTH.naoAutenticado, cabecalhoAuth);
  if (!linha.usuarios?.ativo || linha.usuarios.papel !== "admin") return erro(formato, 401, ERROS_AUTH.naoAutenticado, cabecalhoAuth);

  const uso = await registrarUso(linha.id);
  if (uso === "indisponivel") return erro(formato, 503, ERROS_AUTH.indisponivel);
  if (uso === "limite") return erro(formato, 429, ERROS_AUTH.limite, { "retry-after": String(60 - new Date().getUTCSeconds()) });
  return { chave: { id: linha.id, nome: linha.nome, permissao: linha.permissao, usuarioId: linha.criada_por } };
}
