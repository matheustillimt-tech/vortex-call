import { exigirEscrita, lerCorpo, responder, respostaJson } from "@/src/lib/api/http";
import { criarReuniaoApi } from "@/src/lib/api/reunioes";
import { siteUrl } from "@/src/lib/env";
import { autenticarChave } from "@/src/lib/mcp/auth";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await autenticarChave(req, "rest");
  if (auth instanceof Response) return auth;
  const proibido = exigirEscrita(auth.chave);
  if (proibido) return proibido;
  return responder("POST reunioes", async () => {
    const corpo = await lerCorpo(req);
    return respostaJson(await criarReuniaoApi(dbAdmin(), auth.chave.usuarioId, corpo.titulo, siteUrl()), 201);
  });
}
