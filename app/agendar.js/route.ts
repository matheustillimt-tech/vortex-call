import { siteUrl } from "@/src/lib/env";
import { montarScript } from "@/src/lib/regras/script-encaixe";

export function GET() {
  return new Response(montarScript(siteUrl()), {
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
  });
}
