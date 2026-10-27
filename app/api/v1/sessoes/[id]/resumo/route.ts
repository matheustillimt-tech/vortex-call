import { exigirUuid, responder, respostaJson } from "@/src/lib/api/http";
import { resumoDaSessao } from "@/src/lib/api/resumos";
import { autenticarChave } from "@/src/lib/mcp/auth";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Resumo do que foi alinhado na call (sessão transcrita). `?transcricao=1` traz a transcrição em texto junto. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autenticarChave(req, "rest");
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const comTranscricao = ["1", "true"].includes(new URL(req.url).searchParams.get("transcricao") ?? "");
  return responder("GET sessoes/resumo", async () => respostaJson(await resumoDaSessao(dbAdmin(), exigirUuid(id), { comTranscricao })));
}
