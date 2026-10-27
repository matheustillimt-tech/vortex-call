import "server-only";
import { AwsClient } from "aws4fetch";
import { env, envOpcional } from "./env";

/** Link assinado vale 1 hora. */
export const VALIDADE_LINK_S = 3600;

export type R2Config = { accessKeyId: string; secretAccessKey: string; bucket: string };

/** R2 configurado? Sem as três variáveis (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`), as gravações
 *  ficam no storage da Cloudflare (7 dias), como antes. A conta vem de `CLOUDFLARE_ACCOUNT_ID`. */
export function r2Config(): R2Config | null {
  const accessKeyId = envOpcional("R2_ACCESS_KEY_ID");
  const secretAccessKey = envOpcional("R2_SECRET_ACCESS_KEY");
  const bucket = envOpcional("R2_BUCKET");
  return accessKeyId && secretAccessKey && bucket ? { accessKeyId, secretAccessKey, bucket } : null;
}

function exigirConfig(): R2Config {
  const c = r2Config();
  if (!c) throw new Error("R2 não configurado.");
  return c;
}

function cliente(c: R2Config): AwsClient {
  return new AwsClient({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, service: "s3", region: "auto", retries: 1 });
}

/** Cada pedaço da chave codificado, mantendo as barras (a chave vira caminho na URL). */
function urlDoObjeto(c: R2Config, chave: string): URL {
  const caminho = chave.split("/").map(encodeURIComponent).join("/");
  return new URL(`https://${env("CLOUDFLARE_ACCOUNT_ID")}.r2.cloudflarestorage.com/${encodeURIComponent(c.bucket)}/${caminho}`);
}

/** Link GET assinado (query string, 1 hora). Com `baixar`, o navegador baixa o arquivo como `gravacao.mp4`
 *  em vez de abrir o player. O link nunca vai pra log. */
export async function linkAssinado(chave: string, o: { baixar?: boolean } = {}): Promise<{ url: string; expira: string }> {
  const c = exigirConfig();
  const url = urlDoObjeto(c, chave);
  url.searchParams.set("X-Amz-Expires", String(VALIDADE_LINK_S));
  if (o.baixar) url.searchParams.set("response-content-disposition", "attachment;filename=gravacao.mp4");
  const assinado = await cliente(c).sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return { url: assinado.url, expira: new Date(Date.now() + VALIDADE_LINK_S * 1000).toISOString() };
}

/** Apaga o arquivo. Já apagado (404) não é erro; outra falha sobe (quem chama decide se loga e segue). */
export async function apagar(chave: string): Promise<void> {
  const c = exigirConfig();
  const r = await cliente(c).fetch(urlDoObjeto(c, chave).toString(), { method: "DELETE" });
  if (!r.ok && r.status !== 404) throw new Error(`R2 respondeu ${r.status} ao apagar.`);
}

function desfazerEntidades(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** Chaves com esse prefixo (ListObjectsV2, até 1000: uma sessão ou reunião tem poucas gravações), na ordem do R2
 *  (lexical). */
export async function listarPorPrefixo(prefixo: string): Promise<string[]> {
  const c = exigirConfig();
  const url = new URL(`https://${env("CLOUDFLARE_ACCOUNT_ID")}.r2.cloudflarestorage.com/${encodeURIComponent(c.bucket)}`);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("prefix", prefixo);
  const r = await cliente(c).fetch(url.toString(), { method: "GET" });
  if (!r.ok) throw new Error(`R2 respondeu ${r.status} ao listar.`);
  const xml = await r.text();
  return [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) => desfazerEntidades(m[1]));
}

/** Escolhe o arquivo da gravação entre as chaves do prefixo. O prefixo é único por gravação
 *  (`s_<sessão>_<ms>`), então normalmente há um arquivo só. Ordem: 1) a chave que termina com o `outputFileName` do
 *  webhook (quando veio); 2) a primeira `.mp4`; 3) a primeira chave de qualquer tipo. */
export function escolherChave(chaves: string[], nomeArquivo?: string | null): string | null {
  if (nomeArquivo) {
    const exata = chaves.find((k) => k === nomeArquivo || k.endsWith(`/${nomeArquivo}`) || k.endsWith(`_${nomeArquivo}`));
    if (exata) return exata;
  }
  return chaves.find((k) => k.toLowerCase().endsWith(".mp4")) ?? chaves[0] ?? null;
}

/** Acha o arquivo da gravação pelo prefixo único dela (ver `escolherChave`). `null` quando ainda não há nada no
 *  bucket. */
export async function acharPorPrefixo(prefixo: string, nomeArquivo?: string | null): Promise<string | null> {
  return escolherChave(await listarPorPrefixo(prefixo), nomeArquivo);
}
