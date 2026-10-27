-- Permissões por membro (24/10/2026). O admin liga e desliga, em Equipe → "Permissões", o que cada membro pode fazer.
-- Admin tem tudo sempre. Os padrões abaixo são o comportamento de antes (só `todas_agendas` nasce desligada), então
-- quem já existe continua igual. Mesmos padrões de src/lib/regras/permissoes.ts (mudou lá, muda aqui).
-- Além das checagens nas rotas e actions do servidor, o banco recorta o que a equipe lê pelo cliente dela (REST):
--   * `tem_permissao(chave)`: admin = true; membro ativo = valor salvo, senão o padrão; fora da equipe = false.
--   * `todas_agendas`: leitura de sessões/inscritos/presenças/dashboard de todas as agendas (`pode_ler_agenda`/
--     `pode_ler_sessao`). Escrever (status pelo cliente, horários, sala, ficha, gravações) segue só na agenda dele.
--   * Contato do lead: o cliente da equipe (até o admin) não lê mais `inscricoes.whatsapp/email/respostas` nem
--     `eventos.corpo/mensagem/resposta` (grant por coluna). As telas leem pelo servidor (service role), depois de
--     conferir o acesso, e mascaram quando falta `contato_lead`. Fichas e vendas (que guardam o contato) só aparecem
--     pro membro com `contato_lead`. Coluna nova nessas duas tabelas precisa entrar no grant abaixo.

-- Coluna --------------------------------------------------------------------------------------------------------
alter table public.usuarios add column permissoes jsonb not null default '{
  "dashboard": true, "receita": true, "anfitriao": true, "espiao": true, "ficha": true, "contato_lead": true,
  "horarios": true, "gravacoes": true, "reunioes": true, "todas_agendas": false
}'::jsonb check (jsonb_typeof(permissoes) = 'object');

-- Regras --------------------------------------------------------------------------------------------------------
create or replace function public.permissao_padrao(p_chave text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_chave in ('dashboard', 'receita', 'anfitriao', 'espiao', 'ficha', 'contato_lead', 'horarios', 'gravacoes', 'reunioes')
$$;

create or replace function public.permissao_de(p_permissoes jsonb, p_papel text, p_chave text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_papel = 'admin' then true
    when jsonb_typeof(p_permissoes -> p_chave) = 'boolean' then (p_permissoes ->> p_chave)::boolean
    else permissao_padrao(p_chave)
  end
$$;

create or replace function public.tem_permissao(p_chave text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select permissao_de(u.permissoes, u.papel, p_chave) from usuarios u where u.auth_id = auth.uid() and u.ativo), false)
$$;

-- Leitura (inclui `todas_agendas`). `pode_ver_agenda`/`pode_ver_sessao` seguem sendo "é o responsável" (gestão).
create or replace function public.pode_ler_agenda(p_agenda uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.pode_ver_agenda(p_agenda) or (public.eh_membro() and public.tem_permissao('todas_agendas'))
$$;

create or replace function public.pode_ler_sessao(p_sessao uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.eh_admin() or exists (select 1 from public.sessoes s where s.id = p_sessao and public.pode_ler_agenda(s.agenda_id))
$$;

revoke all on function public.tem_permissao(text) from public, anon;
revoke all on function public.pode_ler_agenda(uuid) from public, anon;
revoke all on function public.pode_ler_sessao(uuid) from public, anon;
grant execute on function public.tem_permissao(text) to authenticated, service_role;
grant execute on function public.pode_ler_agenda(uuid) to authenticated, service_role;
grant execute on function public.pode_ler_sessao(uuid) to authenticated, service_role;

-- Policies de leitura do membro ------------------------------------------------------------------------------------
drop policy membro_le on public.agendas;
drop policy membro_le on public.repeticoes;
drop policy membro_le on public.sessoes;
drop policy membro_le on public.inscricoes;
drop policy membro_le on public.presencas;
drop policy membro_le on public.eventos;
drop policy membro_le on public.atividade_lead;
drop policy membro_le on public.vendas;
drop policy membro_le on public.gravacoes;
drop policy membro_tudo on public.fichas;

create policy membro_le on public.agendas for select to authenticated using (public.pode_ler_agenda(id));
create policy membro_le on public.repeticoes for select to authenticated using (public.pode_ler_agenda(agenda_id));
create policy membro_le on public.sessoes for select to authenticated using (public.pode_ler_agenda(agenda_id));
create policy membro_le on public.inscricoes for select to authenticated using (public.pode_ler_agenda(agenda_id));
create policy membro_le on public.presencas for select to authenticated using (public.pode_ler_sessao(sessao_id));
create policy membro_le on public.eventos for select to authenticated using (public.pode_ler_agenda(agenda_id));
create policy membro_le on public.atividade_lead for select to authenticated using (public.pode_ler_sessao(sessao_id));
-- Venda guarda o e-mail/WhatsApp do comprador: precisa de `receita` e de `contato_lead`.
create policy membro_le on public.vendas for select to authenticated
  using (sessao_id is not null and public.pode_ler_sessao(sessao_id) and public.tem_permissao('receita') and public.tem_permissao('contato_lead'));
-- Gravação: só com `gravacoes`; a de sessão, só da agenda dele (todas_agendas não abre gravação de outra).
create policy membro_le on public.gravacoes for select to authenticated
  using (public.eh_membro() and public.tem_permissao('gravacoes') and (sessao_id is null or public.pode_ver_sessao(sessao_id)));
-- Ficha (chave = WhatsApp do lead): `ficha` + `contato_lead`, só de lead de agenda dele.
create policy membro_le on public.fichas for select to authenticated
  using (public.pode_ver_whatsapp(whatsapp) and public.tem_permissao('ficha') and public.tem_permissao('contato_lead'));
create policy membro_cria on public.fichas for insert to authenticated
  with check (public.pode_ver_whatsapp(whatsapp) and public.tem_permissao('ficha') and public.tem_permissao('contato_lead'));
create policy membro_atualiza on public.fichas for update to authenticated
  using (public.pode_ver_whatsapp(whatsapp) and public.tem_permissao('ficha') and public.tem_permissao('contato_lead'))
  with check (public.pode_ver_whatsapp(whatsapp) and public.tem_permissao('ficha') and public.tem_permissao('contato_lead'));
-- Apagar: como antes (a `membro_tudo` era "for all"), recortado pela agenda dele e pela permissão `ficha`.
create policy membro_apaga on public.fichas for delete to authenticated
  using (public.pode_ver_whatsapp(whatsapp) and public.tem_permissao('ficha'));

-- Contato do lead fora do cliente da equipe (grant por coluna; o servidor lê pela service role) ---------------------
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'inscricoes' and column_name not in ('whatsapp', 'email', 'respostas');
  execute 'revoke select on public.inscricoes from anon, authenticated';
  execute format('grant select (%s) on public.inscricoes to authenticated', cols);

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'eventos' and column_name not in ('corpo', 'mensagem', 'resposta');
  execute 'revoke select on public.eventos from anon, authenticated';
  execute format('grant select (%s) on public.eventos to authenticated', cols);
end $$;

-- Horários: sem `horarios`, o membro não cancela sessão pelo cliente dele (com inscritos, só o admin, como antes) ---
create or replace function public.proteger_cancelamento() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'cancelada' and old.status is distinct from 'cancelada'
     and auth.uid() is not null and not public.eh_admin() then
    if not public.tem_permissao('horarios') then
      raise exception 'Você não tem permissão pra isso. Fale com o admin.' using errcode = '42501';
    end if;
    if exists (select 1 from inscricoes i where i.sessao_id = new.id and i.status = 'agendado') then
      raise exception 'Essa sessão tem inscritos. Só o admin pode cancelar.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Dashboard ---------------------------------------------------------------------------------------------------------
-- Recorte: sem `dashboard`, recusa; admin ou `todas_agendas` = tudo (só leitura); senão as agendas dele.
create or replace function public.dashboard_recorte() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not eh_membro() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if not tem_permissao('dashboard') then raise exception 'sem permissão' using errcode = '42501'; end if;
  if eh_admin() or tem_permissao('todas_agendas') then return null; end if;
  return meu_usuario_id();
end $$;
revoke all on function public.dashboard_recorte() from public, anon, authenticated;

-- Igual à 20261023210000_dashboard_vendedor.sql; sem `receita`, compraram e receita voltam nulos.
create or replace function public.dashboard_resumo(p_de timestamptz, p_ate timestamptz, p_agenda uuid, p_sessao uuid, p_vendedor uuid default null)
returns table (
  inscritos int, vieram int, ficaram_ate_fim int, interagiram int, compraram int,
  receita_centavos bigint, minutos_medios numeric, nota_media numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_resp uuid := dashboard_recorte();
  v_receita boolean := tem_permissao('receita');
begin
  return query
  select
    count(*)::int,
    count(*) filter (where l.veio)::int,
    count(*) filter (where l.veio and l.minutos >= 0.8 * a.duracao_min)::int,
    count(*) filter (where l.veio and l.nota >= 30)::int,
    case when v_receita then (count(*) filter (where l.comprou))::int end,
    case when v_receita then coalesce(sum(l.receita_centavos), 0)::bigint end,
    coalesce(round(avg(l.minutos) filter (where l.veio), 1), 0),
    coalesce(round(avg(l.nota) filter (where l.veio), 1), 0)
  from dashboard_linhas(p_de, p_ate, p_agenda, p_sessao, p_vendedor, v_resp) l
  join agendas a on a.id = l.agenda_id;
end $$;

create or replace function public.dashboard_sessoes(p_de timestamptz, p_ate timestamptz, p_agenda uuid, p_sessao uuid, p_vendedor uuid default null)
returns table (
  id uuid, inicio timestamptz, agenda text, titulo text, inscritos int, vieram int,
  minutos_medios numeric, nota_media numeric, compraram int, receita_centavos bigint, anfitriao text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_resp uuid := dashboard_recorte();
  v_receita boolean := tem_permissao('receita');
begin
  return query
  with t as (
    select
      l.sessao_id,
      count(*)::int as inscritos,
      count(*) filter (where l.veio)::int as vieram,
      round(avg(l.minutos) filter (where l.veio), 1) as minutos_medios,
      round(avg(l.nota) filter (where l.veio), 1) as nota_media,
      count(*) filter (where l.comprou)::int as compraram,
      sum(l.receita_centavos)::bigint as receita_centavos
    from dashboard_linhas(p_de, p_ate, p_agenda, p_sessao, p_vendedor, v_resp) l
    group by l.sessao_id
  )
  select
    s.id, s.inicio, a.nome, s.titulo,
    coalesce(t.inscritos, 0), coalesce(t.vieram, 0),
    coalesce(t.minutos_medios, 0), coalesce(t.nota_media, 0),
    case when v_receita then coalesce(t.compraram, 0) end,
    case when v_receita then coalesce(t.receita_centavos, 0)::bigint end,
    u.nome
  from sessoes s
  join agendas a on a.id = s.agenda_id
  left join usuarios u on u.id = s.anfitriao_id
  left join t on t.sessao_id = s.id
  where s.status <> 'cancelada'
    and (p_de is null or s.inicio >= p_de)
    and (p_ate is null or s.inicio < p_ate)
    and (p_agenda is null or s.agenda_id = p_agenda)
    and (p_sessao is null or s.id = p_sessao)
    and (p_vendedor is null or coalesce(s.anfitriao_id, a.responsavel_id) = p_vendedor)
    and (v_resp is null or a.responsavel_id = v_resp)
  order by s.inicio desc
  limit 200;
end $$;

-- Retenção: sem `dashboard`, recusa; sessão que o membro não lê volta vazia (todas_agendas lê todas).
create or replace function public.dashboard_retencao(p_sessao uuid)
returns table (minuto int, presentes int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not eh_membro() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if not tem_permissao('dashboard') then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not pode_ler_sessao(p_sessao) then return; end if;
  return query
  with s as (
    select se.id, se.inicio, a.duracao_min,
      least(se.inicio + make_interval(mins => a.duracao_min + 120), now()) as fim
    from sessoes se join agendas a on a.id = se.agenda_id
    where se.id = p_sessao
  )
  select g.m::int, (
    select count(distinct p.inscricao_id)::int
    from presencas p
    join inscricoes i on i.id = p.inscricao_id and i.status <> 'cancelado'
    where p.sessao_id = s.id
      and p.entrou_em <= s.inicio + make_interval(mins => g.m)
      and least(coalesce(p.saiu_em, s.fim), s.fim) > s.inicio + make_interval(mins => g.m)
  )
  from s cross join generate_series(0, s.duracao_min + 30) as g(m)
  order by 1;
end $$;

create or replace function public.dashboard_vendedores(p_de timestamptz, p_ate timestamptz, p_agenda uuid, p_vendedor uuid)
returns table (
  vendedor_id uuid, nome text, sessoes int, realizadas int, conduzidas int, sem_anfitriao int,
  antecedencia_media_min numeric, inscritos int, vieram int, interagiram int, nota_media numeric,
  compraram int, receita_centavos bigint
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_resp uuid := dashboard_recorte();
  v_receita boolean := tem_permissao('receita');
begin
  return query
  with ss as (
    select s.inicio, s.aberta_em, s.anfitriao_id, s.anfitriao_entrou_em,
      case when v_resp is null then coalesce(s.anfitriao_id, a.responsavel_id) else v_resp end as vend
    from sessoes s join agendas a on a.id = s.agenda_id
    where s.status <> 'cancelada'
      and (p_de is null or s.inicio >= p_de)
      and (p_ate is null or s.inicio < p_ate)
      and (p_agenda is null or s.agenda_id = p_agenda)
      and (v_resp is not null or p_vendedor is null or coalesce(s.anfitriao_id, a.responsavel_id) = p_vendedor)
      and (v_resp is null or a.responsavel_id = v_resp)
  ),
  por_sessao as (
    select ss.vend,
      count(*) filter (where ss.inicio <= now())::int as sessoes,
      count(*) filter (where ss.aberta_em is not null)::int as realizadas,
      count(*) filter (where ss.anfitriao_id is not null and ss.anfitriao_id = ss.vend)::int as conduzidas,
      count(*) filter (where ss.anfitriao_id is null and ss.inicio <= now())::int as sem_anfitriao,
      round(avg(extract(epoch from ss.inicio - ss.anfitriao_entrou_em) / 60)
        filter (where ss.anfitriao_id = ss.vend and ss.anfitriao_entrou_em is not null), 1) as antecedencia
    from ss group by ss.vend
  ),
  por_lead as (
    select case when v_resp is null then l.vendedor_id else v_resp end as vend,
      count(*)::int as inscritos,
      count(*) filter (where l.veio)::int as vieram,
      count(*) filter (where l.veio and l.nota >= 30)::int as interagiram,
      round(avg(l.nota) filter (where l.veio), 1) as nota_media,
      count(*) filter (where l.comprou)::int as compraram,
      coalesce(sum(l.receita_centavos), 0)::bigint as receita
    from dashboard_linhas(p_de, p_ate, p_agenda, null, case when v_resp is null then p_vendedor end, v_resp) l
    group by 1
  )
  select ps.vend, u.nome, ps.sessoes, ps.realizadas, ps.conduzidas, ps.sem_anfitriao, ps.antecedencia,
    coalesce(pl.inscritos, 0), coalesce(pl.vieram, 0), coalesce(pl.interagiram, 0), pl.nota_media,
    case when v_receita then coalesce(pl.compraram, 0) end,
    case when v_receita then coalesce(pl.receita, 0)::bigint end
  from por_sessao ps
  left join por_lead pl on pl.vend is not distinct from ps.vend
  left join usuarios u on u.id = ps.vend
  order by case when v_receita then coalesce(pl.receita, 0) else 0 end desc, u.nome nulls last;
end $$;
