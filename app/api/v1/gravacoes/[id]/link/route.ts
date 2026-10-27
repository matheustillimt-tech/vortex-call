import { linkGravacao } from "@/src/lib/api/gravacoes";
import { exigirUuid, responder, respostaJson } from "@/src/lib/api/http";
import { autenticarChave } from "@/src/lib/mcp/auth";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autenticarChave(req, "rest");
  if (auth instanceof Response) return auth;
  const { id } = await params;
  return responder("GET gravacoes/link", async () => respostaJson(await linkGravacao(dbAdmin(), exigirUuid(id))));
}
