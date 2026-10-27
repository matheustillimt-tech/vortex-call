-- Resumo final da call (etapa 4).
-- 1) Transcrição completa da Cloudflare (webhook `meeting.transcript`, Whisper no fim da call): uma linha por sessão do
--    RealtimeKit (a sala pode abrir mais de uma vez na mesma meeting); `conteudo` = lista de falas no formato `Trecho`
--    (src/lib/regras/transcricao.ts). Só o servidor lê e grava.
create table public.transcricoes (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references public.sessoes(id) on delete cascade,
  rtk_session_id text not null unique check (length(rtk_session_id) between 1 and 100),
  conteudo jsonb not null,
  recebida_em timestamptz not null default now()
);
create index transcricoes_sessao on public.transcricoes (sessao_id);
alter table public.transcricoes enable row level security;
revoke all on public.transcricoes from anon, authenticated;

-- 2) Fila do resumo final na própria sessão: `pendente` a partir de `resumo_apos` (a avaliação de presença marca com
--    15 min de espera pela transcrição da Cloudflare; a chegada dela antecipa pra já). A rotina /api/cron/resumos
--    gera, manda o evento `resumo` pro CRM e marca `pronto`, `sem_fala` (pouca conversa) ou `falhou` (IA
--    falhou 3 vezes: vai o começo da transcrição no lugar do resumo).
alter table public.sessoes
  add column resumo_estado text null check (resumo_estado in ('pendente', 'pronto', 'sem_fala', 'falhou')),
  add column resumo_apos timestamptz null,
  add column resumo_tentativas int not null default 0 check (resumo_tentativas >= 0);
create index sessoes_resumo_pendente on public.sessoes (resumo_apos) where resumo_estado = 'pendente';

-- 3) Evento novo `resumo` pro CRM (texto do que foi alinhado no card do Kanban; nada pro WhatsApp do lead).
alter table public.eventos drop constraint eventos_evento_check;
alter table public.eventos add constraint eventos_evento_check
  check (evento in ('agendou', 'lembrete_24h', 'lembrete_1h', 'comecou', 'faltou', 'compareceu', 'resumo'));

-- 4) O resumo da última call também fica na ficha do lead (por WhatsApp).
alter table public.fichas
  add column observacoes_call text null check (char_length(observacoes_call) <= 4000),
  add column observacoes_call_em timestamptz null;
