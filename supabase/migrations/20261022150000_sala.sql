-- Etapa 3: sala de vídeo (RealtimeKit).

alter table public.sessoes add column rtk_meeting_id text unique, add column aberta_em timestamptz;

create table public.gravacoes (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid references public.sessoes(id) on delete set null,
  rtk_recording_id text not null unique,
  status text not null, -- qualquer status do RealtimeKit (RECORDING, PAUSED, INVOKED, UPLOADED...): sem CHECK pra não travar o webhook
  download_url text,
  duracao_s int,
  iniciada_em timestamptz,
  terminada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.webhook_recebidos (
  uuid text primary key,
  evento text not null,
  recebido_em timestamptz not null default now()
);

-- Último participante RealtimeKit criado pra cada pessoa (custom_participant_id) em cada meeting: no passe novo
-- o anterior é apagado (revoga os tokens), garantindo uma presença por pessoa. Só o servidor usa (service role).
create table public.passes_rtk (
  custom_id text not null,
  meeting_id text not null,
  participant_id text not null,
  created_at timestamptz default now(),
  primary key (custom_id, meeting_id)
);

create trigger gravacoes_updated_at before update on public.gravacoes for each row execute function public.tocar_updated_at();
alter table public.gravacoes enable row level security;
alter table public.webhook_recebidos enable row level security;
alter table public.passes_rtk enable row level security;
create policy admin_tudo on public.gravacoes for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy membro_le on public.gravacoes for select to authenticated using (public.eh_membro());
-- webhook_recebidos e passes_rtk: só o servidor (service role), sem policies.

-- Guarda a meeting da sessão uma vez só (duas entradas ao mesmo tempo não criam duas salas).
create or replace function public.reservar_meeting(p_sessao uuid, p_meeting text) returns text
language sql security definer set search_path = public, pg_temp as $$
  update sessoes set rtk_meeting_id = coalesce(rtk_meeting_id, p_meeting) where id = p_sessao returning rtk_meeting_id
$$;
revoke all on function public.reservar_meeting(uuid, text) from public, anon, authenticated;
grant execute on function public.reservar_meeting(uuid, text) to service_role;
