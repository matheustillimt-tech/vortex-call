import { exigirEscrita, exigirUuid, responder, respostaJson } from "@/src/lib/api/http";
import { cancelarSessaoApi } from "@/src/lib/api/sessoes";
import { autenticarChave } from "@/src/lib/mcp/auth";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autenticarChave(req, "rest");
  if (auth instanceof Response) return auth;
  const proibido = exigirEscrita(auth.chave);
  if (proibido) return proibido;
  const { id } = await params;
  return responder("POST sessoes/cancelar", async () => respostaJson(await cancelarSessaoApi(dbAdmin(), exigirUuid(id))));
}
