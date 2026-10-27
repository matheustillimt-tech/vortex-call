import { podeLerSessao } from "@/src/lib/acesso";
import { falasParaConsulta } from "@/src/lib/api/resumos";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { transcricaoEmTexto } from "@/src/lib/regras/transcricao";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { membroApi } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Transcrição da call em .txt (botão "Baixar transcrição" da página da sessão). Permissão `transcricao` + leitura
 *  da sessão (inclui `todas_agendas`). A da Cloudflare, senão a do ao vivo. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const membro = await membroApi();
  if (!membro) return Response.json({ erro: "não autenticado" }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ erro: "Sessão não encontrada." }, { status: 404 });
  if (!pode(membro, "transcricao")) return Response.json({ erro: SEM_PERMISSAO }, { status: 403 });
  if (!(await podeLerSessao(membro, id))) return Response.json({ erro: "Sessão não encontrada." }, { status: 404 });
  const texto = transcricaoEmTexto(await falasParaConsulta(dbAdmin(), id));
  if (!texto) return Response.json({ erro: "Essa call não tem transcrição." }, { status: 404 });
  return new Response(`${texto}\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="transcricao-${id.slice(0, 8)}.txt"`,
      "cache-control": "no-store",
    },
  });
}
