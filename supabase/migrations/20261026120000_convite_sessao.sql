-- Link de convidado da sessão (26/10/2026): o anfitrião copia na sala um link `/s/{codigo}` pra chamar um sócio ou
-- parceiro, que entra na hora (sem login, sem inscrição, sem contar vaga) enquanto a sessão está ao vivo. Um código
-- por sessão, gerado no primeiro clique pelo servidor (src/lib/convite.ts). Tabela à parte (e não coluna em
-- `sessoes`) porque a equipe lê `sessoes` pelo cliente dela: o código é um segredo de entrada e fica só com a
-- service role (RLS ligada, sem policies, sem grant).
create table public.convites_sessao (
  sessao_id uuid primary key references public.sessoes(id) on delete cascade,
  codigo text not null unique constraint convites_sessao_codigo_formato check (codigo ~ '^[A-Za-z0-9_-]{22}$'),
  criado_por uuid references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.convites_sessao enable row level security;
revoke all on public.convites_sessao from anon, authenticated;
