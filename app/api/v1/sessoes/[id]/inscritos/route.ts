import { exigirUuid, responder, respostaJson } from "@/src/lib/api/http";
import { listarInscritos } from "@/src/lib/api/inscritos";
import { autenticarChave } from "@/src/lib/mcp/auth";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autenticarChave(req, "rest");
  if (auth instanceof Response) return auth;
  const { id } = await params;
  return responder("GET sessoes/inscritos", async () => respostaJson(await listarInscritos(dbAdmin(), exigirUuid(id))));
}
