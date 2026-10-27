import { listarAgendas } from "@/src/lib/api/agendas";
import { responder, respostaJson } from "@/src/lib/api/http";
import { siteUrl } from "@/src/lib/env";
import { autenticarChave } from "@/src/lib/mcp/auth";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await autenticarChave(req, "rest");
  if (auth instanceof Response) return auth;
  return responder("GET agendas", async () => respostaJson(await listarAgendas(dbAdmin(), siteUrl())));
}
