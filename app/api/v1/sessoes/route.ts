import { dataDaQuery, exigirEscrita, lerCorpo, responder, respostaJson } from "@/src/lib/api/http";
import { criarSessaoApi, listarSessoes } from "@/src/lib/api/sessoes";
import { autenticarChave } from "@/src/lib/mcp/auth";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await autenticarChave(req, "rest");
  if (auth instanceof Response) return auth;
  return responder("GET sessoes", async () => {
    const url = new URL(req.url);
    const filtro = { agenda: url.searchParams.get("agenda") || null, de: dataDaQuery(url, "de"), ate: dataDaQuery(url, "ate", { fimDoDia: true }) };
    return respostaJson(await listarSessoes(dbAdmin(), filtro));
  });
}

export async function POST(req: Request) {
  const auth = await autenticarChave(req, "rest");
  if (auth instanceof Response) return auth;
  const proibido = exigirEscrita(auth.chave);
  if (proibido) return proibido;
  return responder("POST sessoes", async () => respostaJson(await criarSessaoApi(dbAdmin(), await lerCorpo(req)), 201));
}
