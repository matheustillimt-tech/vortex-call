-- Reunião instantânea: sala gerada na hora com link /r/{codigo}, vale 24 h ou até alguém da equipe encerrar.
-- Todas as escritas são do servidor (service role, depois de checar o membro logado); a equipe só lê.

create table public.reunioes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[a-z0-9]{10}$'),
  titulo text not null default 'Reunião rápida',
  criada_por uuid references public.usuarios(id) on delete set null,
  rtk_meeting_id text unique,
  encerrada_em timestamptz,
  expira_em timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reunioes_abertas on public.reunioes (expira_em) where encerrada_em is null;

create trigger reunioes_updated_at before update on public.reunioes for each row execute function public.tocar_updated_at();
alter table public.reunioes enable row level security;
create policy admin_tudo on public.reunioes for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy membro_le on public.reunioes for select to authenticated using (public.eh_membro());

-- Gravação de reunião instantânea (a de sessão continua em sessao_id).
alter table public.gravacoes add column reuniao_id uuid references public.reunioes(id) on delete set null;
