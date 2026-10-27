-- Transcrição ao vivo (etapa 2): as falas finais que a sala do anfitrião recebe do RealtimeKit (`meeting.ai`), em
-- lotes de 15 s (`POST /api/sala/transcricao/{sessao}`). `rtk_id` é o id da fala no RealtimeKit: a mesma fala mandada
-- duas vezes (reenvio, dois anfitriões) entra uma vez só. Só o servidor (service role) lê e grava: a equipe vê pela
-- rota, depois de conferir o acesso à sessão e a permissão `transcricao`.
create table public.transcricao_trechos (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references public.sessoes(id) on delete cascade,
  rtk_id text not null check (length(rtk_id) between 1 and 100),
  falante_nome text not null check (length(falante_nome) between 1 and 100),
  custom_id text null check (length(custom_id) <= 200),
  texto text not null check (length(texto) between 1 and 2000),
  falado_em timestamptz not null,
  created_at timestamptz not null default now(),
  unique (sessao_id, rtk_id)
);
create index transcricao_trechos_sessao on public.transcricao_trechos (sessao_id, falado_em);

alter table public.transcricao_trechos enable row level security;
revoke all on public.transcricao_trechos from anon, authenticated;

-- Permissão nova `transcricao` (ver a aba "Alinhado" na sala), ligada por padrão. Mesmos padrões de
-- src/lib/regras/permissoes.ts.
create or replace function public.permissao_padrao(p_chave text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_chave in ('dashboard', 'receita', 'anfitriao', 'espiao', 'ficha', 'contato_lead', 'horarios', 'gravacoes', 'reunioes', 'transcricao')
$$;
