-- Inscrição pública atômica e vitrine de sessões. Chamadas só pelo servidor (service role).

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
  update inscricoes i set status = case when o.status = 'cancelada' then 'cancelado' else 'faltou' end
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
    update inscricoes set sessao_id = p_sessao, email = coalesce(email, p_email) where id = existente.id;
    return query select 'reagendada'::text, existente.id, existente.codigo;
    return;
  end if;

  insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp, email, resposta_type_id, respostas, utm, origem)
    values (p_sessao, s.agenda_id, p_codigo, p_nome, p_whatsapp, p_email, p_resposta, p_respostas, coalesce(p_utm, '{}'::jsonb), p_origem)
    returning id into novo_id;
  return query select 'nova'::text, novo_id, p_codigo;
end $$;

create or replace function public.vitrine_agenda(p_slug text)
returns table (id uuid, inicio timestamptz, vagas int, inscritos int, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.inicio, s.vagas,
    (select count(*)::int from inscricoes i where i.sessao_id = s.id and i.status = 'agendado'),
    s.status
  from sessoes s join agendas a on a.id = s.agenda_id
  where a.slug = p_slug and a.ativa and s.status = 'agendada' and s.inicio > now()
    and s.inicio < now() + interval '60 days'
  order by s.inicio
$$;

-- Backstop de esquema: no máximo uma inscrição ativa por WhatsApp em cada agenda (reforça a trava acima).
create unique index inscricoes_uma_ativa_por_agenda on public.inscricoes (agenda_id, whatsapp) where status = 'agendado';

revoke all on function public.inscrever(uuid, text, text, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.vitrine_agenda(text) from public, anon, authenticated;
grant execute on function public.inscrever(uuid, text, text, text, text, text, jsonb, jsonb, text) to service_role;
grant execute on function public.vitrine_agenda(text) to service_role;
