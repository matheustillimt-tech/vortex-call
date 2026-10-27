import { DateTime } from "luxon";
import type { ChaveAutenticada } from "../mcp/auth";

/** Erro de negócio da API REST v1: vira `{ erro }` com o status dado (404, 409, 422, 502...). */
export class ErroApi extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem);
  }
}

const SEM_CACHE = { "cache-control": "no-store" };
const FUSO = "America/Sao_Paulo";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function respostaErro(status: number, erro: string): Response {
  return Response.json({ erro }, { status, headers: SEM_CACHE });
}

export function respostaJson(corpo: unknown, status = 200): Response {
  return Response.json(corpo, { status, headers: SEM_CACHE });
}

/** POST só com chave de escrita: devolve a resposta 403 pronta, ou `null` se pode seguir. */
export function exigirEscrita(chave: ChaveAutenticada): Response | null {
  return chave.permissao === "escrita" ? null : respostaErro(403, "Esta chave é só de leitura.");
}

export function ehUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** Id do caminho: precisa ser uuid (senão 422, sem nem ir ao banco). */
export function exigirUuid(v: string): string {
  if (!ehUuid(v)) throw new ErroApi(422, "Id inválido.");
  return v;
}

/** Instante aceito pela API: ISO com fuso (`...Z`, `...-03:00`), data e hora sem fuso com ou sem segundos
 *  (`2026-10-30T14:00`, `2026-10-30T14:00:05.123`, lidas em Brasília) ou só a data (`2026-10-30`, meia-noite de
 *  Brasília; com `fimDoDia`, o último milissegundo do dia, pra `ate` incluir o dia todo sem pegar a meia-noite
 *  seguinte). Data impossível (30/02, 25:00) ou qualquer outra coisa → `null`. */
export function lerInstante(v: unknown, o: { fimDoDia?: boolean } = {}): Date | null {
  if (typeof v !== "string") return null;
  let d: DateTime;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    d = DateTime.fromISO(v, { zone: FUSO });
    if (d.isValid && o.fimDoDia) d = d.plus({ days: 1 }).minus({ milliseconds: 1 });
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?$/.test(v)) {
    d = DateTime.fromISO(v, { zone: FUSO });
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/i.test(v)) {
    d = DateTime.fromISO(v, { setZone: true });
  } else return null;
  return d.isValid ? d.toJSDate() : null;
}

/** Parâmetro de data da query (`de`, `ate`): ausente → `null`; inválido → 422. */
export function dataDaQuery(url: URL, nome: string, o: { fimDoDia?: boolean } = {}): Date | null {
  const v = url.searchParams.get(nome);
  if (v === null || v === "") return null;
  const d = lerInstante(v, o);
  if (!d) throw new ErroApi(422, `Data inválida em "${nome}". Use ISO 8601, por exemplo 2026-10-30T14:00:00-03:00.`);
  return d;
}

/** Corpo JSON de um POST: vazio → `{}`; não JSON ou não objeto → 422. */
export async function lerCorpo(req: Request): Promise<Record<string, unknown>> {
  const texto = await req.text();
  if (!texto.trim()) return {};
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch {
    throw new ErroApi(422, "Corpo inválido: mande um objeto JSON.");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ErroApi(422, "Corpo inválido: mande um objeto JSON.");
  return v as Record<string, unknown>;
}

/** Roda o handler: `ErroApi` vira `{ erro }` com o status dele; qualquer outro erro vira 500 genérico (no log só a
 *  mensagem, nunca dados de lead). */
export async function responder(rotulo: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErroApi) return respostaErro(e.status, e.message);
    console.error(`[api] ${rotulo}`, e instanceof Error ? e.message : "erro");
    return respostaErro(500, "Erro interno. Tente de novo.");
  }
}
