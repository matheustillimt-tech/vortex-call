import { listarGravacoes } from "@/src/lib/api/gravacoes";
import { dataDaQuery, responder, respostaJson } from "@/src/lib/api/http";
import { autenticarChave } from "@/src/lib/mcp/auth";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await autenticarChave(req, "rest");
  if (auth instanceof Response) return auth;
  return responder("GET gravacoes", async () => {
    const url = new URL(req.url);
    return respostaJson(await listarGravacoes(dbAdmin(), { de: dataDaQuery(url, "de"), ate: dataDaQuery(url, "ate", { fimDoDia: true }) }));
  });
}
