-- Vórtex Call: esquema das etapas 1 e 2 (spec de 22/10/2026). Datas em UTC.

create extension if not exists pgcrypto;

create or replace function public.tocar_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Equipe --------------------------------------------------------------------------------------------------------
create table public.usuarios (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid not null unique references auth.users(id) on delete cascade,
  nome text not null,
  email text not null unique,
  papel text not null default 'membro' check (papel in ('admin', 'membro')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.eh_membro() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where auth_id = auth.uid() and ativo)
$$;

create or replace function public.eh_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where auth_id = auth.uid() and ativo and papel = 'admin')
$$;

-- Marca (linha única) -------------------------------------------------------------------------------------------
create table public.configuracao (
  id int primary key default 1 check (id = 1),
  nome text not null default 'Sua Empresa',
  logo_url text,
  cor_marca text not null default '#0a8452' check (cor_marca ~ '^#[0-9a-fA-F]{6}$'),
  whatsapp_suporte text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.configuracao (id) values (1);

-- Agendas -------------------------------------------------------------------------------------------------------
create table public.agendas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  titulo_publico text not null default 'Escolha o melhor horário pra sua call',
  descricao text not null default '',
  duracao_min int not null default 60 check (duracao_min between 15 and 480),
  vagas_padrao int not null default 30 check (vagas_padrao between 1 and 500),
  abre_antes_min int not null default 5 check (abre_antes_min between 0 and 60),
  roteiro text not null default '',
  grava_sozinha boolean not null default true,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.repeticoes (
  id uuid primary key default gen_random_uuid(),
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  dias_semana int[] not null check (cardinality(dias_semana) >= 1 and dias_semana <@ array[0,1,2,3,4,5,6]),
  hora text not null check (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  vagas int not null check (vagas between 1 and 500),
  ate date,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sessoes (
  id uuid primary key default gen_random_uuid(),
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  repeticao_id uuid references public.repeticoes(id) on delete set null,
  titulo text,
  inicio timestamptz not null,
  vagas int not null check (vagas between 1 and 500),
  status text not null default 'agendada' check (status in ('agendada', 'ao_vivo', 'encerrada', 'cancelada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repeticao_id, inicio)
);
create index sessoes_agenda_inicio on public.sessoes (agenda_id, inicio);

create table public.inscricoes (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references public.sessoes(id) on delete cascade,
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  codigo text not null unique check (codigo ~ '^[a-z0-9]{10}$'),
  nome text not null,
  whatsapp text not null check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  resposta_type_id text,
  respostas jsonb,
  utm jsonb not null default '{}'::jsonb,
  origem text not null default 'pagina' check (origem in ('pagina', 'encaixe', 'painel')),
  status text not null default 'agendado' check (status in ('agendado', 'compareceu', 'faltou', 'cancelado')),
  minutos_na_sala int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inscricoes_sessao on public.inscricoes (sessao_id, status);
create index inscricoes_whatsapp on public.inscricoes (agenda_id, whatsapp);

-- Limite de requisições públicas (por IP com hash e janela de 1 min) --------------------------------------------
create table public.limites (
  chave text not null,
  janela timestamptz not null,
  total int not null default 0,
  primary key (chave, janela)
);

-- updated_at e RLS em tudo --------------------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    if t <> 'limites' then
      execute format('create trigger %I before update on public.%I for each row execute function public.tocar_updated_at()', t || '_updated_at', t);
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy admin_tudo on public.%I for all to authenticated using (public.eh_admin()) with check (public.eh_admin())', t);
  end loop;
end $$;

-- Membro: lê agendas, sessões e inscritos; marca sessões e inscrições (abrir sala, presença manual).
create policy membro_le on public.agendas for select to authenticated using (public.eh_membro());
create policy membro_le on public.repeticoes for select to authenticated using (public.eh_membro());
create policy membro_le on public.sessoes for select to authenticated using (public.eh_membro());
create policy membro_le on public.inscricoes for select to authenticated using (public.eh_membro());
create policy membro_le on public.configuracao for select to authenticated using (public.eh_membro());
create policy membro_atualiza on public.sessoes for update to authenticated using (public.eh_membro()) with check (public.eh_membro());
create policy membro_atualiza on public.inscricoes for update to authenticated using (public.eh_membro()) with check (public.eh_membro());

-- Equipe: membros leem, só admin escreve.
drop policy admin_tudo on public.usuarios;
create policy ler_equipe on public.usuarios for select to authenticated using (public.eh_membro());
create policy admin_equipe on public.usuarios for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- Limites: só o servidor (service role ignora RLS).
drop policy admin_tudo on public.limites;
