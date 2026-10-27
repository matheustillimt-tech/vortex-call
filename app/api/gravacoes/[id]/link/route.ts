import { NextResponse } from "next/server";
import { podeVerGravacao } from "@/src/lib/acesso";
import { linkGravacao } from "@/src/lib/api/gravacoes";
import { ErroApi, ehUuid } from "@/src/lib/api/http";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

/** Página curtinha pra quando o link não dá: a gravação não existe ou já passou dos 7 dias que a Cloudflare
 *  guarda (`linkGravacao` devolve 404 nos dois casos; não dá para saber qual sem contar, e a mensagem serve
 *  pros dois). */
function paginaIndisponivel(): Response {
  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8" /><title>Gravação indisponível</title></head>
<body style="font-family: system-ui, sans-serif; display: grid; min-height: 100vh; place-items: center; margin: 0; background: #fafafa; color: #3f3f46;">
  <p style="max-width: 28rem; padding: 0 1.5rem; text-align: center;">Essa gravação já expirou (a Cloudflare guarda por 7 dias).</p>
</body>
</html>`;
  return new Response(html, { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** Logada: admin, ou membro que vê a gravação (sessão de agenda dele, ou reunião instantânea). Gera o link na hora (assinado de 1 hora no R2, ou pedido ao
 *  RealtimeKit) e redireciona (302): o link vence, então nunca fica salvo em lugar nenhum além da resposta.
 *  `?baixar=1`: no R2 o link assinado já pede o download (`gravacao.mp4`); na Cloudflare o redirecionamento é o
 *  mesmo e o botão da tela usa o atributo `download`. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const membro = await membroApi();
  if (!membro) return new Response("Não autorizado.", { status: 401 });
  // Sem a permissão `gravacoes`: nem assistir nem baixar.
  if (!pode(membro, "gravacoes")) return new Response(SEM_PERMISSAO, { status: 403, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

  const { id } = await params;
  if (!ehUuid(id)) return paginaIndisponivel();
  if (!(await podeVerGravacao(membro, id))) return paginaIndisponivel();

  try {
    const baixar = new URL(req.url).searchParams.get("baixar") === "1";
    const { url } = await linkGravacao(dbAdmin(), id, new Date(), { baixar });
    let protocolo: string;
    try {
      protocolo = new URL(url).protocol;
    } catch {
      protocolo = "";
    }
    if (protocolo !== "https:") return paginaIndisponivel();
    const resposta = NextResponse.redirect(url, 302);
    resposta.headers.set("cache-control", "no-store");
    return resposta;
  } catch (e) {
    if (e instanceof ErroApi && e.status === 404) return paginaIndisponivel();
    console.error("[gravacoes/link]", e instanceof Error ? e.message : "erro");
    return new Response("Não deu para buscar o link agora. Tente de novo.", { status: 502, headers: { "cache-control": "no-store" } });
  }
}
