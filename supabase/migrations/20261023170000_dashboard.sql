-- Etapa 7: atividade do lead na sala, vendas por webhook, gravação no R2, exclusões e funções do dashboard.

-- Atividade do lead (microfone, câmera e chat), somada pela sala a cada 30 s ----------------------------------------
create table public.atividade_lead (
  inscricao_id uuid primary key references public.inscricoes(id) on delete cascade,
  sessao_id uuid not null references public.sessoes(id) on delete cascade,
  mic_s int not null default 0 check (mic_s >= 0),
  cam_s int not null default 0 check (cam_s >= 0),
  msgs int not null default 0 check (msgs >= 0),
  updated_at timestamptz not null default now()
);
create index atividade_lead_sessao on public.atividade_lead (sessao_id);

-- Vendas (webhook da plataforma de pagamento), ligadas à última inscrição que assistiu ------------------------------------------
create table public.vendas (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  status text not null check (status in ('aprovada', 'reembolsada')),
  valor_centavos int not null default 0 check (valor_centavos >= 0),
  produto text,
  email text,
  whatsapp text,
  comprada_em timestamptz not null default now(),
  inscricao_id uuid references public.inscricoes(id) on delete set null,
  sessao_id uuid references public.sessoes(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vendas_inscricao on public.vendas (inscricao_id);
create index vendas_sessao on public.vendas (sessao_id);

create trigger atividade_lead_updated_at before update on public.atividade_lead for each row execute function public.tocar_updated_at();
create trigger vendas_updated_at before update on public.vendas for each row execute function public.tocar_updated_at();

alter table public.atividade_lead enable row level security;
alter table public.vendas enable row level security;
create policy admin_tudo on public.atividade_lead for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy membro_le on public.atividade_lead for select to authenticated using (public.eh_membro());
create policy admin_tudo on public.vendas for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy membro_le on public.vendas for select to authenticated using (public.eh_membro());
-- Grants explícitos (o Supabase já dá por padrão; RLS decide quem vê). Anônimo fica sem acesso nenhum.
revoke all on public.atividade_lead, public.vendas from anon;
grant select, insert, update, delete on public.atividade_lead, public.vendas to authenticated;

-- Gravação no R2: chave do arquivo; e a gravação vai junto quando a sessão ou a reunião é excluída ---------------
-- r2_prefixo: prefixo único escolhido quando o Vórtex Call começa a gravar (`s_<sessão>_<ms>` / `r_<reunião>_<ms>`);
-- r2_chave: chave do arquivo achada no bucket por esse prefixo.
alter table public.gravacoes add column r2_chave text, add column r2_prefixo text;
alter table public.gravacoes drop constraint gravacoes_sessao_id_fkey;
alter table public.gravacoes drop constraint gravacoes_reuniao_id_fkey;
alter table public.gravacoes
  add constraint gravacoes_sessao_id_fkey foreign key (sessao_id) references public.sessoes(id) on delete cascade,
  add constraint gravacoes_reuniao_id_fkey foreign key (reuniao_id) references public.reunioes(id) on delete cascade;
create index gravacoes_sessao on public.gravacoes (sessao_id);
create index gravacoes_reuniao on public.gravacoes (reuniao_id);

-- Soma a atividade de um envio da sala. Tetos por chamada (anti-fraude): 35 s de microfone, 35 s de câmera,
-- 20 mensagens; negativo vira 0. Só soma com a sessão ao vivo e a inscrição dela (não cancelada) (senão não faz nada e devolve false).
-- Se a inscrição foi reagendada pra outra sessão, a contagem recomeça na sessão nova.
create or replace function public.somar_atividade(p_inscricao uuid, p_sessao uuid, p_mic int, p_cam int, p_msgs int)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from inscricoes i join sessoes s on s.id = i.sessao_id
    where i.id = p_inscricao and s.id = p_sessao and s.status = 'ao_vivo' and i.status <> 'cancelado'
  ) then
    return false;
  end if;
  insert into atividade_lead as a (inscricao_id, sessao_id, mic_s, cam_s, msgs)
  values (
    p_inscricao, p_sessao,
    least(greatest(coalesce(p_mic, 0), 0), 35),
    least(greatest(coalesce(p_cam, 0), 0), 35),
    least(greatest(coalesce(p_msgs, 0), 0), 20)
  )
  on conflict (inscricao_id) do update set
    mic_s = case when a.sessao_id = excluded.sessao_id then a.mic_s + excluded.mic_s else excluded.mic_s end,
    cam_s = case when a.sessao_id = excluded.sessao_id then a.cam_s + excluded.cam_s else excluded.cam_s end,
    msgs = case when a.sessao_id = excluded.sessao_id then a.msgs + excluded.msgs else excluded.msgs end,
    sessao_id = excluded.sessao_id;
  return true;
end $$;
revoke all on function public.somar_atividade(uuid, uuid, int, int, int) from public, anon, authenticated;
grant execute on function public.somar_atividade(uuid, uuid, int, int, int) to service_role;

-- Nota de interação (0 a 100). Mesma fórmula de src/lib/regras/interacao.ts (mudou lá, muda aqui):
-- 40 × min(1, minutos/duração) + 25 × min(1, msgs/5) + 20 × min(1, mic_s/120) + 15 × min(1, cam_s/(duração × 60 × 0,5)),
-- arredondada (round(total, 6) antes, como o toFixed(6) do JS). Quem não veio fica com 0 (decidido por quem chama).
create or replace function public.nota_interacao(p_minutos numeric, p_duracao_min numeric, p_msgs numeric, p_mic_s numeric, p_cam_s numeric)
returns int language sql immutable set search_path = public, pg_temp as $$
  select case when coalesce(p_duracao_min, 0) <= 0 then 0 else round(round(
      40 * least(1, greatest(coalesce(p_minutos, 0), 0) / p_duracao_min)
    + 25 * least(1, greatest(coalesce(p_msgs, 0), 0) / 5.0)
    + 20 * least(1, greatest(coalesce(p_mic_s, 0), 0) / 120.0)
    + 15 * least(1, greatest(coalesce(p_cam_s, 0), 0) / (p_duracao_min * 60 * 0.5))
  , 6))::int end
$$;
grant execute on function public.nota_interacao(numeric, numeric, numeric, numeric, numeric) to authenticated, service_role;

-- Base do dashboard: uma linha por inscrição (não cancelada) das sessões do filtro (não canceladas).
-- Período por sessoes.inicio em [p_de, p_ate); null em qualquer filtro = sem filtro.
-- veio = compareceu OU tem presença. minutos = soma das presenças unidas, cortadas no início da sessão e no fim da
-- janela (início + duração + 2 h, ou agora se for antes); sem nenhuma presença (ex.: marcado à mão no painel), vale o
-- minutos_na_sala gravado. Uso interno: só as funções do dashboard (security definer) chamam.
create or replace function public.dashboard_linhas(p_de timestamptz, p_ate timestamptz, p_agenda uuid, p_sessao uuid)
returns table (sessao_id uuid, inscricao_id uuid, veio boolean, minutos int, nota int, comprou boolean, receita_centavos bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    s.id, i.id, v.veio, m.minutos,
    case when v.veio then nota_interacao(m.minutos, a.duracao_min, coalesce(al.msgs, 0), coalesce(al.mic_s, 0), coalesce(al.cam_s, 0)) else 0 end,
    coalesce(vd.qtd, 0) > 0,
    coalesce(vd.total, 0)
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
$$;
revoke all on function public.dashboard_linhas(timestamptz, timestamptz, uuid, uuid) from public, anon, authenticated;

-- Cartões do funil (uma linha). Só equipe logada.
create or replace function public.dashboard_resumo(p_de timestamptz, p_ate timestamptz, p_agenda uuid, p_sessao uuid)
returns table (
  inscritos int, vieram int, ficaram_ate_fim int, interagiram int, compraram int,
  receita_centavos bigint, minutos_medios numeric, nota_media numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not eh_membro() then raise exception 'acesso negado' using errcode = '42501'; end if;
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
  from dashboard_linhas(p_de, p_ate, p_agenda, p_sessao) l
  join sessoes s on s.id = l.sessao_id
  join agendas a on a.id = s.agenda_id;
end $$;

-- Tabela por sessão (mais recentes primeiro, até 200). Sessão sem inscrito aparece com zeros.
create or replace function public.dashboard_sessoes(p_de timestamptz, p_ate timestamptz, p_agenda uuid, p_sessao uuid)
returns table (
  id uuid, inicio timestamptz, agenda text, titulo text, inscritos int, vieram int,
  minutos_medios numeric, nota_media numeric, compraram int, receita_centavos bigint
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not eh_membro() then raise exception 'acesso negado' using errcode = '42501'; end if;
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
    from dashboard_linhas(p_de, p_ate, p_agenda, p_sessao) l
    group by l.sessao_id
  )
  select
    s.id, s.inicio, a.nome, s.titulo,
    coalesce(t.inscritos, 0), coalesce(t.vieram, 0),
    coalesce(t.minutos_medios, 0), coalesce(t.nota_media, 0),
    coalesce(t.compraram, 0), coalesce(t.receita_centavos, 0)::bigint
  from sessoes s
  join agendas a on a.id = s.agenda_id
  left join t on t.sessao_id = s.id
  where s.status <> 'cancelada'
    and (p_de is null or s.inicio >= p_de)
    and (p_ate is null or s.inicio < p_ate)
    and (p_agenda is null or s.agenda_id = p_agenda)
    and (p_sessao is null or s.id = p_sessao)
  order by s.inicio desc
  limit 200;
end $$;

-- Retenção minuto a minuto (0 até duração + 30): inscrições distintas (não canceladas) na sala em cada minuto desde o
-- início (minuto 0 = início; quem entrou antes conta a partir do 0).
-- Saída nula = ainda na sala até o fim da janela (início + duração + 2 h, ou agora se for antes).
create or replace function public.dashboard_retencao(p_sessao uuid)
returns table (minuto int, presentes int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not eh_membro() then raise exception 'acesso negado' using errcode = '42501'; end if;
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

revoke all on function public.dashboard_resumo(timestamptz, timestamptz, uuid, uuid) from public, anon;
revoke all on function public.dashboard_sessoes(timestamptz, timestamptz, uuid, uuid) from public, anon;
revoke all on function public.dashboard_retencao(uuid) from public, anon;
grant execute on function public.dashboard_resumo(timestamptz, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.dashboard_sessoes(timestamptz, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.dashboard_retencao(uuid) to authenticated;

-- O que vai junto ao excluir (tela de confirmação). Tipos: agenda, sessao, reuniao, gravacao.
-- Equipe logada (painel) ou servidor (service role, sem auth.uid(), usado pela API); anônimo não executa.
-- "avisos" = eventos pro CRM; "vendas" = vendas ligadas (ficam, só perdem o vínculo).
create or replace function public.contar_dependencias(p_tipo text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_sessoes int := 0; v_inscritos int := 0; v_gravacoes int := 0; v_avisos int := 0; v_vendas int := 0;
begin
  if auth.uid() is not null and not eh_membro() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if p_tipo = 'agenda' then
    select count(*) into v_sessoes from sessoes where agenda_id = p_id;
    select count(*) into v_inscritos from inscricoes where agenda_id = p_id;
    select count(*) into v_gravacoes from gravacoes g join sessoes s on s.id = g.sessao_id where s.agenda_id = p_id;
    select count(*) into v_avisos from eventos where agenda_id = p_id;
    select count(*) into v_vendas from vendas v
      where v.inscricao_id in (select id from inscricoes where agenda_id = p_id)
         or v.sessao_id in (select id from sessoes where agenda_id = p_id);
  elsif p_tipo = 'sessao' then
    select count(*) into v_inscritos from inscricoes where sessao_id = p_id;
    select count(*) into v_gravacoes from gravacoes where sessao_id = p_id;
    select count(*) into v_avisos from eventos e
      where e.sessao_id = p_id or e.inscricao_id in (select id from inscricoes where sessao_id = p_id);
    select count(*) into v_vendas from vendas v
      where v.sessao_id = p_id or v.inscricao_id in (select id from inscricoes where sessao_id = p_id);
  elsif p_tipo = 'reuniao' then
    select count(*) into v_gravacoes from gravacoes where reuniao_id = p_id;
  elsif p_tipo = 'gravacao' then
    select count(*) into v_gravacoes from gravacoes where id = p_id;
  else
    raise exception 'tipo inválido: %', p_tipo using errcode = '22023';
  end if;
  return jsonb_build_object(
    'sessoes', v_sessoes, 'inscritos', v_inscritos, 'gravacoes', v_gravacoes, 'avisos', v_avisos, 'vendas', v_vendas
  );
end $$;
revoke all on function public.contar_dependencias(text, uuid) from public, anon, authenticated;
grant execute on function public.contar_dependencias(text, uuid) to authenticated, service_role;
