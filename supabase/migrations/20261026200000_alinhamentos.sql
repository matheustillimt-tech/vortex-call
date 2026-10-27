-- "Alinhado até agora" e resumo final da call (etapas 3 e 4). Um `ao_vivo` por sessão (refeito pela IA a cada 2 min
-- enquanto entra fala nova) e um `final` (depois da call). `dados` é o JSON validado (src/lib/regras/alinhamento.ts),
-- `texto` é o resumo no formato fixo que vai pro card do CRM. `total_trechos` diz com quantas falas foi feito
-- (sem fala nova, não chama a IA de novo). Só o servidor (service role) lê e grava.
create table public.alinhamentos (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references public.sessoes(id) on delete cascade,
  tipo text not null check (tipo in ('ao_vivo', 'final')),
  origem text not null check (origem in ('ao_vivo', 'cloudflare')),
  dados jsonb not null,
  texto text not null,
  total_trechos int not null default 0 check (total_trechos >= 0),
  gerado_em timestamptz not null default now(),
  unique (sessao_id, tipo)
);

alter table public.alinhamentos enable row level security;
revoke all on public.alinhamentos from anon, authenticated;
