import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

export const PRELUDIO = `
  create role authenticated; create role anon; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
`;

/** Privilégios padrão do Supabase (toda tabela nova nasce com grant pra anon/authenticated/service_role; quem decide
 *  é a RLS). Ligado só nos testes que precisam ler tabelas como `authenticated` sem grant explícito. */
const PRIVILEGIOS_SUPABASE = `
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`;

export async function bancoComMigracoes(o: { privilegiosSupabase?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(PRELUDIO);
  if (o.privilegiosSupabase) await db.exec(PRIVILEGIOS_SUPABASE);
  const dir = path.join(__dirname, "../supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(path.join(dir, f), "utf8"));
  return db;
}
