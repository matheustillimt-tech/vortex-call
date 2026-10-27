import { montarPreset, PRESETS } from "../src/lib/regras/presets";

const base = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/realtime/kit/${process.env.REALTIMEKIT_APP_ID}`;
const H = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" };
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
const COR = process.env.COR_MARCA ?? "#0a8452";

async function chamar(metodo: string, caminho: string, corpo?: unknown) {
  const r = await fetch(base + caminho, { method: metodo, headers: H, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status} ${JSON.stringify(j)}`);
  return j?.data ?? j;
}

async function main() {
  const existentes: { id: string; name: string }[] = await chamar("GET", "/presets");
  for (const nome of PRESETS) {
    const corpo = montarPreset(nome, COR);
    const ja = existentes.find((p) => p.name === nome);
    if (ja) await chamar("PATCH", `/presets/${ja.id}`, corpo);
    else await chamar("POST", "/presets", corpo);
    console.log(`preset ${nome}: ${ja ? "atualizado" : "criado"}`);
  }
  const url = `${SITE}/api/webhooks/realtimekit`;
  // Sem nenhum webhook cadastrado, a API responde 404 "Webhook not found" em vez de lista vazia.
  const ganchos: { id: string; url: string }[] = await chamar("GET", "/webhooks").catch((e: Error) => {
    if (e.message.includes("→ 404")) return [];
    throw e;
  });
  const eventos = ["meeting.started", "meeting.ended", "meeting.participantJoined", "meeting.participantLeft", "recording.statusUpdate", "meeting.transcript"];
  const g = ganchos.find((x) => x.url === url);
  if (g) await chamar("PATCH", `/webhooks/${g.id}`, { name: "vortex-call", url, events: eventos, enabled: true });
  else await chamar("POST", "/webhooks", { name: "vortex-call", url, events: eventos, enabled: true });
  console.log(`webhook ${url}: ${g ? "atualizado" : "criado"}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
