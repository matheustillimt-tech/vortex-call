import "server-only";

export type VarObrigatoria =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "NEXT_PUBLIC_SITE_URL"
  | "CRON_SECRET"
  | "CRYPTO_KEY"
  | "CLOUDFLARE_ACCOUNT_ID"
  | "CLOUDFLARE_API_TOKEN"
  | "REALTIMEKIT_APP_ID";

export function envOpcional(nome: string): string | undefined {
  const v = process.env[nome];
  return v ? v : undefined;
}

export function env(nome: VarObrigatoria): string {
  const v = envOpcional(nome);
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

/** `NEXT_PUBLIC_SITE_URL` sem barra(s) no fim, pra montar link/origem sem vira `...br//c/codigo`. */
export function siteUrl(): string {
  return env("NEXT_PUBLIC_SITE_URL").replace(/\/+$/, "");
}

/** IA configurada? Sem `OPENROUTER_API_KEY` + `OPENROUTER_TEXT_MODEL` (um modelo ou vários separados por vírgula: o
 *  primeiro é o principal, os outros reserva), o resumo da ficha e o resumo da call ficam desligados (devolve `null`). */
export function iaConfig(): { openrouterKey: string; modelo: string } | null {
  const openrouterKey = envOpcional("OPENROUTER_API_KEY");
  const modelo = envOpcional("OPENROUTER_TEXT_MODEL");
  if (!openrouterKey || !modelo) return null;
  return { openrouterKey, modelo };
}
