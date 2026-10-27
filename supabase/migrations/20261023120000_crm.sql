-- Etapa 5: fila de eventos pro CRM (webhook por agenda) e presença na sala (RealtimeKit).

alter table public.agendas
  add column crm_urls jsonb not null default '{}'::jsonb,
  add column crm_segredo text;

alter table public.sessoes add column avaliada_em timestamptz;
-- Sessões que começaram antes desta migração não têm histórico de presença (a tabela presencas nasce agora):
-- ficam fora da avaliação, senão todo inscrito ainda "agendado" delas viraria "faltou".
update public.sessoes set avaliada_em = now() where inicio < now();

-- Quando a pessoa agendou NESTA sessão (muda ao reagendar; created_at não muda). Os lembretes olham pra cá:
-- quem reagendou pra uma sessão perto demais não recebe o lembrete de 24 h fora de hora.
alter table public.inscricoes add column agendado_em timestamptz not null default now();
update public.inscricoes set agendado_em = created_at;

create table public.presencas (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references public.sessoes(id) on delete cascade,
  inscricao_id uuid not null references public.inscricoes(id) on delete cascade,
  peer_id text not null unique,
  entrou_em timestamptz not null,
  saiu_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index presencas_sessao on public.presencas (sessao_id);
create index presencas_inscricao on public.presencas (inscricao_id);

create table public.eventos (
  id uuid primary key default gen_random_uuid(),
  id_evento text not null unique,
  evento text not null check (evento in ('agendou', 'lembrete_24h', 'lembrete_1h', 'comecou', 'faltou', 'compareceu')),
  inscricao_id uuid not null references public.inscricoes(id) on delete cascade,
  sessao_id uuid references public.sessoes(id) on delete set null,
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  corpo jsonb not null,
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'falhou', 'sem_destino')),
  tentativas int not null default 0,
  proxima_em timestamptz not null default now(),
  resposta_status int,
  resposta text,
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index eventos_fila on public.eventos (status, proxima_em);

create trigger presencas_updated_at before update on public.presencas for each row execute function public.tocar_updated_at();
create trigger eventos_updated_at before update on public.eventos for each row execute function public.tocar_updated_at();

alter table public.presencas enable row level security;
alter table public.eventos enable row level security;

create policy admin_tudo on public.presencas for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy membro_le on public.presencas for select to authenticated using (public.eh_membro());

create policy admin_tudo on public.eventos for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy membro_le on public.eventos for select to authenticated using (public.eh_membro());

-- Enfileira um evento sem duplicar pelo id_evento (a rotina que gera eventos chama sempre; o banco garante o "só uma vez").
create or replace function public.enfileirar_evento(
  p_id_evento text, p_evento text, p_inscricao uuid, p_sessao uuid, p_agenda uuid, p_corpo jsonb, p_sem_destino boolean
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare linhas int;
begin
  insert into eventos (id_evento, evento, inscricao_id, sessao_id, agenda_id, corpo, status)
  values (p_id_evento, p_evento, p_inscricao, p_sessao, p_agenda, p_corpo, case when p_sem_destino then 'sem_destino' else 'pendente' end)
  on conflict (id_evento) do nothing;
  get diagnostics linhas = row_count;
  return linhas > 0;
end $$;
revoke all on function public.enfileirar_evento(text, text, uuid, uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.enfileirar_evento(text, text, uuid, uuid, uuid, jsonb, boolean) to service_role;

-- Reivindica até p_limite eventos pendentes e vencidos, empurrando proxima_em 2 minutos (lease) pra que uma
-- segunda chamada de entrega (cron atrasado, instância duplicada) não pegue a mesma linha enquanto a primeira
-- ainda está mandando o webhook. `for update skip locked` resolve a corrida entre duas chamadas concorrentes.
create or replace function public.reivindicar_eventos(p_limite int, p_agora timestamptz) returns setof eventos
language sql security definer set search_path = public, pg_temp as $$
  update eventos set proxima_em = p_agora + interval '2 minutes'
  where id in (
    select id from eventos where status = 'pendente' and proxima_em <= p_agora order by proxima_em limit p_limite for update skip locked
  )
  returning *;
$$;
revoke all on function public.reivindicar_eventos(int, timestamptz) from public, anon, authenticated;
grant execute on function public.reivindicar_eventos(int, timestamptz) to service_role;

-- Inscrição pública (mesma assinatura e permissões da 20261022130000_inscrever.sql), com duas mudanças da etapa 5:
-- reagendar atualiza agendado_em e as inscrições velhas fecham como compareceu/faltou/cancelado pelo que aconteceu.
create or replace function public.inscrever(
  p_sessao uuid, p_codigo text, p_nome text, p_whatsapp text, p_email text,
  p_resposta text, p_respostas jsonb, p_utm jsonb, p_origem text
) returns table (resultado text, inscricao_id uuid, codigo text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  s record;
  existente record;
  ocupadas int;
  novo_id uuid;
begin
  select * into s from sessoes where id = p_sessao for update;
  if not found or s.status <> 'agendada' or s.inicio <= now() then
    return query select 'indisponivel'::text, null::uuid, null::text;
    return;
  end if;

  -- Trava por pessoa na agenda: duas chamadas concorrentes com o mesmo WhatsApp, mesmo em sessões
  -- diferentes da mesma agenda, serializam aqui (a segunda só segue depois do commit/rollback da primeira).
  perform pg_advisory_xact_lock(hashtextextended(s.agenda_id::text || ':' || p_whatsapp, 0));

  -- Fecha inscrições ativas velhas da mesma pessoa na mesma agenda (sessão passada ou cancelada):
  -- sem isso, a inscrição ativa velha bate no índice único e essa pessoa nunca mais consegue agendar.
  -- Etapa 5: sessão cancelada = cancelado; entrou na sala (tem presença) = compareceu; senão faltou.
  update inscricoes i set status = case
      when o.status = 'cancelada' then 'cancelado'
      when exists (select 1 from presencas p where p.inscricao_id = i.id) then 'compareceu'
      else 'faltou'
    end
    from sessoes o
    where o.id = i.sessao_id and i.agenda_id = s.agenda_id and i.whatsapp = p_whatsapp
      and i.status = 'agendado' and (o.status <> 'agendada' or o.inicio <= now());

  -- Mesma pessoa já na sessão: devolve a inscrição.
  select i.id, i.codigo into existente from inscricoes i
    where i.sessao_id = p_sessao and i.whatsapp = p_whatsapp and i.status = 'agendado' limit 1;
  if found then
    return query select 'mesma'::text, existente.id, existente.codigo;
    return;
  end if;

  select count(*) into ocupadas from inscricoes i where i.sessao_id = p_sessao and i.status = 'agendado';
  if ocupadas >= s.vagas then
    return query select 'lotada'::text, null::uuid, null::text;
    return;
  end if;

  -- Mesma pessoa em outra sessão futura agendada da mesma agenda: muda de sessão (mesmo código).
  select i.id, i.codigo into existente from inscricoes i
    join sessoes o on o.id = i.sessao_id
    where i.agenda_id = s.agenda_id and i.whatsapp = p_whatsapp and i.status = 'agendado'
      and o.status = 'agendada' and o.inicio > now()
    order by i.created_at desc limit 1;
  if found then
    update inscricoes set sessao_id = p_sessao, agendado_em = now(), email = coalesce(email, p_email) where id = existente.id;
    return query select 'reagendada'::text, existente.id, existente.codigo;
    return;
  end if;

  insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp, email, resposta_type_id, respostas, utm, origem)
    values (p_sessao, s.agenda_id, p_codigo, p_nome, p_whatsapp, p_email, p_resposta, p_respostas, coalesce(p_utm, '{}'::jsonb), p_origem)
    returning id into novo_id;
  return query select 'nova'::text, novo_id, p_codigo;
end $$;
revoke all on function public.inscrever(uuid, text, text, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.inscrever(uuid, text, text, text, text, text, jsonb, jsonb, text) to service_role;
