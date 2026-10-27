import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";

let unico: SupabaseClient | undefined;

/** Service role: ignora RLS. Só rotas do servidor (sala, cron, webhooks) e ações de admin. */
export function dbAdmin(): SupabaseClient {
  unico ??= createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return unico;
}
