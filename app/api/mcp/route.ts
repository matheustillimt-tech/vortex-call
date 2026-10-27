import { metodoNaoPermitido, tratarPostMcp } from "@/src/lib/mcp/servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST /api/mcp: servidor MCP do Vórtex Call (Streamable HTTP sem estado, respostas JSON). */
export async function POST(req: Request) {
  return tratarPostMcp(req);
}

/** GET (SSE) e DELETE (sessão) não existem neste servidor sem estado → 405. */
export function GET() {
  return metodoNaoPermitido();
}

export function DELETE() {
  return metodoNaoPermitido();
}
