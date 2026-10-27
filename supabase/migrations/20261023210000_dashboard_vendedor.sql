-- Dashboard por vendedor (23/10/2026). Mesmas contas da 20261023170000_dashboard.sql, com duas mudanças:
-- 1) Recorte: admin vê tudo; membro vê só as agendas em que é o responsável (mesmo pedindo outra agenda/sessão).
-- 2) Vendedor da sessão = coalesce(sessoes.anfitriao_id, agendas.responsavel_id): quem conduziu, senão o dono da agenda.
--    Filtro opcional `p_vendedor` em todas as funções e a tabela nova `dashboard_vendedores`.
-- As assinaturas mudam (parâmetro novo com default), então as funções velhas saem antes.

drop function public.dashboard_resumo(timestamptz, timestamptz, uuid, uuid);
drop function public.dashboard_sessoes(timestamptz, timestamptz, uuid, uuid);
drop function public.dashboard_linhas(timestamptz, timestamptz, uuid, uuid);

-- Base: uma linha por inscrição (não cancelada) das sessões do filtro (não canceladas). Igual à versão anterior, mais
-- `agenda_id` e `vendedor_id`, e dois filtros: `p_vendedor` (vendedor da sessão) e `p_responsavel` (só agendas desse
-- responsável; quem chama passa o membro logado, ou null pro admin). Uso interno: só as funções do dashboard chamam.
create function public.dashboard_linhas(
  p_de timestamptz, p_ate timestamptz, p_agenda uuid, p_sessao uuid, p_vendedor uuid default null, p_responsavel uuid default null
)
returns table (
  sessao_id uuid, inscricao_id uuid, veio boolean, minutos int, nota int, comprou boolean, receita_centavos bigint,
  agenda_id uuid, vendedor_id uuid
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    s.id, i.id, v.veio, m.minutos,
    case when v.veio then nota_interacao(m.minutos, a.duracao_min, coalesce(al.msgs, 0), coalesce(al.mic_s, 0), coalesce(al.cam_s, 0)) else 0 end,
    coalesce(vd.qtd, 0) > 0,
    coalesce(vd.total, 0),
    a.id,
    coalesce(s.anfitriao_id, a.responsavel_id)
  from sessoes s
  join agendas a on a.id = s.agenda_id
  join inscricoes i on i.sessao_id = s.id and i.status <> 'cancelado'
  cross join lateral (select least(s.inicio + make_interval(mins => a.duracao_min + 120), now()) as fim) j
  cross join lateral (
    select x.tem_presenca, i.status = 'compareceu' or x.tem_presenca as veio
    from (select exists (select 1 from presencas p where p.inscricao_id = i.id and p.sessao_id = s.id) as tem_presenca) x
  ) v
  cross join lateral (
    select case when not v.tem_presenca then i.minutos_na_sala else coalesce((
      select floor(sum(extract(epoch from upper(r) - lower(r))) / 60)::int
      from unnest((
        select range_agg(tstzrange(greatest(p.entrou_em, s.inicio), least(coalesce(p.saiu_em, j.fim), j.fim)))
        from presencas p
        where p.inscricao_id = i.id and p.sessao_id = s.id
          and greatest(p.entrou_em, s.inicio) < least(coalesce(p.saiu_em, j.fim), j.fim)
      )) r
    ), 0) end as minutos
  ) m
  left join atividade_lead al on al.inscricao_id = i.id and al.sessao_id = s.id
  left join lateral (
    select count(*) as qtd, sum(vv.valor_centavos)::bigint as total
    from vendas vv where vv.inscricao_id = i.id and vv.status = 'aprovada'
  ) vd on true
  where s.status <> 'cancelada'
    and (p_de is null or s.inicio >= p_de)
    and (p_ate is null or s.inicio < p_ate)
    and (p_agenda is null or s.agenda_id = p_agenda)
    and (p_sessao is null or s.id = p_sessao)
    and (p_vendedor is null or coalesce(s.anfitriao_id, a.responsavel_id) = p_vendedor)
    and (p_responsavel is null or a.responsavel_id = p_responsavel)
$$;
revoke all on function public.dashboard_linhas(timestamptz, timestamptz, uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- Recorte de quem chama: null = admin (vê tudo); senão o id do membro (só as agendas dele). Fora da equipe: erro.
create or replace function public.dashboard_recorte() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not eh_membro() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if eh_admin() then return null; end if;
  return meu_usuario_id();
end $$;
revoke all on function public.dashboard_recorte() from public, anon, authenticated;

-- Cartões do funil (uma linha).
create function public.dashboard_resumo(p_de timestamptz, p_ate timestamptz, p_agenda uuid, p_sessao uuid, p_vendedor uuid default null)
returns table (
  inscritos int, vieram int, ficaram_ate_fim int, interagiram int, compraram int,
  receita_centavos bigint, minutos_medios numeric, nota_media numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_resp uuid := dashboard_recorte();
begin
  return query
  select
    count(*)::int,
    count(*) filter (where l.veio)::int,
    count(*) filter (where l.veio and l.minutos >= 0.8 * a.duracao_min)::int,
    count(*) filter (where l.veio and l.nota >= 30)::int,
    count(*) filter (where l.comprou)::int,
    coalesce(sum(l.receita_centavos), 0)::bigint,
    coalesce(round(avg(l.minutos) filter (where l.veio), 1), 0),
    coalesce(round(avg(l.nota) filter (where l.veio), 1), 0)
  from dashboard_linhas(p_de, p_ate, p_agenda, p_sessao, p_vendedor, v_resp) l
  join agendas a on a.id = l.agenda_id;
end $$;

-- Tabela por sessão (mais recentes primeiro, até 200). Sessão sem inscrito aparece com zeros. `anfitriao` = nome de
-- quem entrou primeiro como anfitrião (null = ninguém).
create function public.dashboard_sessoes(p_de timestamptz, p_ate timestamptz, p_agenda uuid, p_sessao uuid, p_vendedor uuid default null)
returns table (
  id uuid, inicio timestamptz, agenda text, titulo text, inscritos int, vieram int,
  minutos_medios numeric, nota_media numeric, compraram int, receita_centavos bigint, anfitriao text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_resp uuid := dashboard_recorte();
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
    coalesce(t.compraram, 0), coalesce(t.receita_centavos, 0)::bigint,
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

-- Retenção: mesma conta; sessão que o membro não vê volta vazia.
create or replace function public.dashboard_retencao(p_sessao uuid)
returns table (minuto int, presentes int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not eh_membro() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if not pode_ver_sessao(p_sessao) then return; end if;
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

-- Uma linha por vendedor. Admin: todos (vendedor da sessão = anfitrião, senão o responsável), mais "sem vendedor" com
-- id nulo, e o filtro `p_vendedor`. Membro: uma linha só, a dele, com TODAS as sessões das agendas dele (mesmo recorte
-- dos cartões do funil; `p_vendedor` é ignorado), e "conduzidas"/"entrada" contando só as que ele abriu.
-- sessoes = sessões que já começaram; realizadas = a sala foi aberta; conduzidas = ele entrou primeiro como anfitrião;
-- sem_anfitriao = já começaram e ninguém entrou como anfitrião; antecedencia_media_min = média de minutos antes do
-- início em que ele entrou nas que conduziu (negativo = atrasado); o resto como o funil (todas as sessões do filtro).
create function public.dashboard_vendedores(p_de timestamptz, p_ate timestamptz, p_agenda uuid, p_vendedor uuid)
returns table (
  vendedor_id uuid, nome text, sessoes int, realizadas int, conduzidas int, sem_anfitriao int,
  antecedencia_media_min numeric, inscritos int, vieram int, interagiram int, nota_media numeric,
  compraram int, receita_centavos bigint
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_resp uuid := dashboard_recorte();
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
    coalesce(pl.compraram, 0), coalesce(pl.receita, 0)::bigint
  from por_sessao ps
  left join por_lead pl on pl.vend is not distinct from ps.vend
  left join usuarios u on u.id = ps.vend
  order by coalesce(pl.receita, 0) desc, u.nome nulls last;
end $$;

revoke all on function public.dashboard_resumo(timestamptz, timestamptz, uuid, uuid, uuid) from public, anon;
revoke all on function public.dashboard_sessoes(timestamptz, timestamptz, uuid, uuid, uuid) from public, anon;
revoke all on function public.dashboard_retencao(uuid) from public, anon;
revoke all on function public.dashboard_vendedores(timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.dashboard_resumo(timestamptz, timestamptz, uuid, uuid, uuid) to authenticated;
grant execute on function public.dashboard_sessoes(timestamptz, timestamptz, uuid, uuid, uuid) to authenticated;
grant execute on function public.dashboard_retencao(uuid) to authenticated;
grant execute on function public.dashboard_vendedores(timestamptz, timestamptz, uuid, uuid) to authenticated;
