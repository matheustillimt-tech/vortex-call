-- Horários pelo vendedor (23/10/2026): o responsável pela agenda (membro) cria sessão avulsa e repetição, para
-- repetição, muda as vagas de uma sessão e cancela sessão SEM inscritos. As ações do painel conferem "admin ou
-- responsável" e gravam pela service role; as duas funções abaixo fazem a parte que precisa ser atômica (trava a linha
-- da sessão, a mesma que a `inscrever` trava, então nenhuma inscrição entra no meio da conta). Os grants por coluna
-- da 20261023200000_vendedor.sql continuam iguais (a equipe, pelo cliente dela, só muda `status`).

-- Cancela só se não houver inscrito ativo (`agendado`). Resultado: ok | tem_inscritos | nao_agendada | nao_encontrada.
create or replace function public.cancelar_sessao_vazia(p_sessao uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s record;
  ativos int;
begin
  select id, status into s from sessoes where id = p_sessao for update;
  if not found then return 'nao_encontrada'; end if;
  if s.status <> 'agendada' then return 'nao_agendada'; end if;
  select count(*) into ativos from inscricoes where sessao_id = p_sessao and status = 'agendado';
  if ativos > 0 then return 'tem_inscritos'; end if;
  update sessoes set status = 'cancelada' where id = p_sessao;
  return 'ok';
end $$;
revoke all on function public.cancelar_sessao_vazia(uuid) from public, anon, authenticated;
grant execute on function public.cancelar_sessao_vazia(uuid) to service_role;

-- Muda as vagas de sessão agendada sem ficar abaixo dos inscritos ativos (mesma conta de vaga da `inscrever`).
-- Devolve { resultado: ok | abaixo_inscritos | invalida | nao_agendada | nao_encontrada, inscritos }.
create or replace function public.alterar_vagas_sessao(p_sessao uuid, p_vagas int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s record;
  ativos int;
begin
  if p_vagas is null or p_vagas < 1 or p_vagas > 500 then
    return jsonb_build_object('resultado', 'invalida', 'inscritos', 0);
  end if;
  select id, status into s from sessoes where id = p_sessao for update;
  if not found then return jsonb_build_object('resultado', 'nao_encontrada', 'inscritos', 0); end if;
  if s.status <> 'agendada' then return jsonb_build_object('resultado', 'nao_agendada', 'inscritos', 0); end if;
  select count(*) into ativos from inscricoes where sessao_id = p_sessao and status = 'agendado';
  if p_vagas < ativos then return jsonb_build_object('resultado', 'abaixo_inscritos', 'inscritos', ativos); end if;
  update sessoes set vagas = p_vagas where id = p_sessao;
  return jsonb_build_object('resultado', 'ok', 'inscritos', ativos);
end $$;
revoke all on function public.alterar_vagas_sessao(uuid, int) from public, anon, authenticated;
grant execute on function public.alterar_vagas_sessao(uuid, int) to service_role;

-- O membro ainda muda `status` pelo cliente dele (grant por coluna + RLS da agenda dele): sem esta trava, cancelaria
-- direto pela API do Supabase uma sessão com inscritos. Logado e não admin = recusa cancelar com inscrito ativo.
-- Admin e servidor (sem auth.uid()) seguem como antes.
create or replace function public.proteger_cancelamento() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'cancelada' and old.status is distinct from 'cancelada'
     and auth.uid() is not null and not public.eh_admin()
     and exists (select 1 from inscricoes i where i.sessao_id = new.id and i.status = 'agendado') then
    raise exception 'Essa sessão tem inscritos. Só o admin pode cancelar.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger sessoes_proteger_cancelamento before update on public.sessoes for each row execute function public.proteger_cancelamento();
