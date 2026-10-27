-- Etapa 7 (tarefa 5): liga a venda (webhook de pagamento) à inscrição que assistiu e faz o upsert por order_id.

-- Acha e registra a venda. Link: a inscrição mais recente que veio (mesma regra do dashboard_linhas: não cancelada e
-- com status 'compareceu' OU com presença na sessão; quem compra durante a oferta ainda está 'agendado'), mesmo WhatsApp
-- (ou, sem telefone batendo, mesmo e-mail sem diferenciar caixa) e cuja sessão começou entre
-- `p_comprada_em - 7 dias` e `p_comprada_em`; sem match, a venda fica sem vínculo (inscricao_id/sessao_id null).
-- Aprovada: insere ou atualiza por order_id. Reembolsada: só marca o status se a venda já existe; sem venda
-- existente, insere direto como reembolsada (webhook pode chegar fora de ordem).
create or replace function public.registrar_venda(
  p_order_id text, p_status text, p_valor_centavos int, p_produto text,
  p_email text, p_whatsapp text, p_comprada_em timestamptz, p_payload jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inscricao uuid;
  v_sessao uuid;
  v_linhas int;
begin
  if p_whatsapp is not null then
    select i.id, i.sessao_id into v_inscricao, v_sessao
      from inscricoes i join sessoes s on s.id = i.sessao_id
      where i.status <> 'cancelado'
        and (i.status = 'compareceu' or exists (select 1 from presencas p where p.inscricao_id = i.id and p.sessao_id = s.id))
        and i.whatsapp = p_whatsapp
        and s.inicio between p_comprada_em - interval '7 days' and p_comprada_em
      order by s.inicio desc limit 1;
  end if;
  if v_inscricao is null and p_email is not null then
    select i.id, i.sessao_id into v_inscricao, v_sessao
      from inscricoes i join sessoes s on s.id = i.sessao_id
      where i.status <> 'cancelado'
        and (i.status = 'compareceu' or exists (select 1 from presencas p where p.inscricao_id = i.id and p.sessao_id = s.id))
        and lower(i.email) = lower(p_email)
        and s.inicio between p_comprada_em - interval '7 days' and p_comprada_em
      order by s.inicio desc limit 1;
  end if;

  if p_status = 'aprovada' then
    insert into vendas (order_id, status, valor_centavos, produto, email, whatsapp, comprada_em, inscricao_id, sessao_id, payload)
      values (p_order_id, 'aprovada', p_valor_centavos, p_produto, p_email, p_whatsapp, p_comprada_em, v_inscricao, v_sessao, p_payload)
    on conflict (order_id) do update set
      status = 'aprovada', valor_centavos = excluded.valor_centavos, produto = excluded.produto,
      email = excluded.email, whatsapp = excluded.whatsapp, comprada_em = excluded.comprada_em,
      inscricao_id = excluded.inscricao_id, sessao_id = excluded.sessao_id, payload = excluded.payload;
  else
    update vendas set status = 'reembolsada', payload = p_payload where order_id = p_order_id;
    get diagnostics v_linhas = row_count;
    if v_linhas = 0 then
      insert into vendas (order_id, status, valor_centavos, produto, email, whatsapp, comprada_em, inscricao_id, sessao_id, payload)
        values (p_order_id, 'reembolsada', p_valor_centavos, p_produto, p_email, p_whatsapp, p_comprada_em, v_inscricao, v_sessao, p_payload);
    end if;
  end if;
end $$;
revoke all on function public.registrar_venda(text, text, int, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_venda(text, text, int, text, text, text, timestamptz, jsonb) to service_role;

-- Liga à inscrição as vendas que ficaram sem vínculo (ex.: chegou antes da presença ser gravada). Chamada pela
-- avaliação da sessão (src/lib/disparos.ts) quando a inscrição vira 'compareceu'. Mesma regra de "veio" e de casamento
-- do registrar_venda (mesmo WhatsApp ou mesmo e-mail sem diferenciar caixa), compra entre o início da sessão e 7 dias
-- depois. Venda já ligada a outra inscrição não muda. Devolve quantas vendas ligou.
create or replace function public.religar_vendas(p_inscricao uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_linhas int;
begin
  update vendas v set inscricao_id = i.id, sessao_id = i.sessao_id
    from inscricoes i join sessoes s on s.id = i.sessao_id
    where i.id = p_inscricao and i.status <> 'cancelado'
      and (i.status = 'compareceu' or exists (select 1 from presencas p where p.inscricao_id = i.id and p.sessao_id = s.id))
      and v.inscricao_id is null
      and ((i.whatsapp is not null and v.whatsapp = i.whatsapp) or (i.email is not null and lower(v.email) = lower(i.email)))
      and v.comprada_em between s.inicio and s.inicio + interval '7 days';
  get diagnostics v_linhas = row_count;
  return v_linhas;
end $$;
revoke all on function public.religar_vendas(uuid) from public, anon, authenticated;
grant execute on function public.religar_vendas(uuid) to service_role;
