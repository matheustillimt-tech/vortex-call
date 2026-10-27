-- Etapa 4: coluna da ficha. Uma ficha por pessoa (WhatsApp E.164): resumo por IA e observações da equipe.
-- Sobrevive entre sessões e agendas (a mesma pessoa em outra call vê o mesmo resumo e as mesmas observações).

create table public.fichas (
  whatsapp text primary key check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  resumo_ia text,
  resumo_em timestamptz,
  observacoes text not null default '' check (char_length(observacoes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger fichas_updated_at before update on public.fichas for each row execute function public.tocar_updated_at();

alter table public.fichas enable row level security;
-- Só a equipe (admin ou membro ativo) lê e grava. Anônimo não tem acesso nenhum.
create policy membro_tudo on public.fichas for all to authenticated using (public.eh_membro()) with check (public.eh_membro());
revoke all on public.fichas from anon;
grant select, insert, update on public.fichas to authenticated;
