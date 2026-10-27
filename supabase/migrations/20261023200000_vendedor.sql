-- Vendedor responsável (23/10/2026): cada agenda pode ter um vendedor (usuário da equipe). Membro que não é admin
-- passa a ver SÓ os dados das agendas em que é o responsável (RLS abaixo + checagem nas rotas que usam a service role).
-- A sessão guarda quem entrou primeiro como anfitrião. Avisos pro vendedor no WhatsApp saem por uma fila própria
-- (`avisos_equipe`), com URL e segredo únicos do CRM em `configuracao`.

-- Colunas --------------------------------------------------------------------------------------------------------
alter table public.agendas add column responsavel_id uuid references public.usuarios(id) on delete set null;
create index agendas_responsavel on public.agendas (responsavel_id);

alter table public.usuarios add column whatsapp text check (whatsapp ~ '^\+[1-9][0-9]{7,14}$');

alter table public.sessoes
  add column anfitriao_id uuid references public.usuarios(id) on delete set null,
  add column anfitriao_entrou_em timestamptz;
create index sessoes_anfitriao on public.sessoes (anfitriao_id);

alter table public.configuracao add column crm_url_equipe text, add column crm_segredo_equipe text;

-- O segredo dos avisos da equipe nunca sai pela API da equipe (nem pro admin: a tela só diz se existe, lendo pelo
-- servidor). Grant por coluna: a equipe continua lendo a marca e a URL.
revoke select on public.configuracao from anon, authenticated;
grant select (id, nome, logo_url, cor_marca, whatsapp_suporte, crm_url_equipe, created_at, updated_at) on public.configuracao to authenticated;

-- O segredo do CRM de cada agenda (avisos do lead) também não sai pela API da equipe: o editor nunca mostra o segredo
-- (só grava) e a entrega/o "Enviar teste" leem pelo servidor. Leitura de agendas pelo cliente da pessoa sempre com
-- colunas nomeadas (nunca `*`).
revoke select on public.agendas from anon, authenticated;
grant select (
  id, nome, slug, titulo_publico, descricao, duracao_min, vagas_padrao, abre_antes_min, roteiro, grava_sozinha, ativa,
  crm_urls, responsavel_id, created_at, updated_at
) on public.agendas to authenticated;

-- Sessões e inscrições: a equipe, pelo cliente dela, só muda o `status` (cancelar sessão/inscrições no painel, presença
-- manual). Todo o resto (sala, anfitrião, avaliação, reagendamento, meeting) é do servidor (service role). Sem isso, um
-- membro poderia trocar o WhatsApp de uma inscrição (e ler a ficha de outro lead) ou mover a inscrição pra sessão de
-- outra agenda.
revoke update on public.sessoes, public.inscricoes from anon, authenticated;
grant update (status) on public.sessoes, public.inscricoes to authenticated;

-- Quem pode ver o quê ---------------------------------------------------------------------------------------------
create or replace function public.meu_usuario_id() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.usuarios where auth_id = auth.uid() and ativo
$$;

-- Admin vê toda agenda; membro só a que tem ele como responsável.
create or replace function public.pode_ver_agenda(p_agenda uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or (
    public.eh_membro() and exists (
      select 1 from public.agendas a where a.id = p_agenda and a.responsavel_id = public.meu_usuario_id()
    )
  )
$$;

create or replace function public.pode_ver_sessao(p_sessao uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (select 1 from public.sessoes s where s.id = p_sessao and public.pode_ver_agenda(s.agenda_id))
$$;

-- Ficha é por WhatsApp: o membro vê a de quem se inscreveu numa agenda dele.
create or replace function public.pode_ver_whatsapp(p_whatsapp text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (
    select 1 from public.inscricoes i where i.whatsapp = p_whatsapp and public.pode_ver_agenda(i.agenda_id)
  )
$$;

revoke all on function public.meu_usuario_id() from public, anon;
revoke all on function public.pode_ver_agenda(uuid) from public, anon;
revoke all on function public.pode_ver_sessao(uuid) from public, anon;
revoke all on function public.pode_ver_whatsapp(text) from public, anon;
grant execute on function public.meu_usuario_id() to authenticated, service_role;
grant execute on function public.pode_ver_agenda(uuid) to authenticated, service_role;
grant execute on function public.pode_ver_sessao(uuid) to authenticated, service_role;
grant execute on function public.pode_ver_whatsapp(text) to authenticated, service_role;

-- Policies de membro recortadas pela agenda (admin_tudo continua igual) --------------------------------------------
drop policy membro_le on public.agendas;
drop policy membro_le on public.repeticoes;
drop policy membro_le on public.sessoes;
drop policy membro_le on public.inscricoes;
drop policy membro_atualiza on public.sessoes;
drop policy membro_atualiza on public.inscricoes;
drop policy membro_tudo on public.fichas;
drop policy membro_le on public.gravacoes;
drop policy membro_le on public.presencas;
drop policy membro_le on public.eventos;
drop policy membro_le on public.atividade_lead;
drop policy membro_le on public.vendas;

create policy membro_le on public.agendas for select to authenticated using (public.pode_ver_agenda(id));
create policy membro_le on public.repeticoes for select to authenticated using (public.pode_ver_agenda(agenda_id));
create policy membro_le on public.sessoes for select to authenticated using (public.pode_ver_agenda(agenda_id));
create policy membro_le on public.inscricoes for select to authenticated using (public.pode_ver_agenda(agenda_id));
create policy membro_atualiza on public.sessoes for update to authenticated
  using (public.pode_ver_agenda(agenda_id)) with check (public.pode_ver_agenda(agenda_id));
create policy membro_atualiza on public.inscricoes for update to authenticated
  using (public.pode_ver_agenda(agenda_id)) with check (public.pode_ver_agenda(agenda_id));
create policy admin_tudo on public.fichas for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy membro_tudo on public.fichas for all to authenticated
  using (public.pode_ver_whatsapp(whatsapp)) with check (public.pode_ver_whatsapp(whatsapp));
-- Gravação de reunião instantânea segue como antes (toda a equipe); a de sessão, só de quem vê a sessão.
create policy membro_le on public.gravacoes for select to authenticated
  using (public.eh_membro() and (sessao_id is null or public.pode_ver_sessao(sessao_id)));
create policy membro_le on public.presencas for select to authenticated using (public.pode_ver_sessao(sessao_id));
create policy membro_le on public.eventos for select to authenticated using (public.pode_ver_agenda(agenda_id));
create policy membro_le on public.atividade_lead for select to authenticated using (public.pode_ver_sessao(sessao_id));
-- Venda sem vínculo (não achou a inscrição) só o admin vê.
create policy membro_le on public.vendas for select to authenticated using (sessao_id is not null and public.pode_ver_sessao(sessao_id));

-- Anfitrião: só o servidor grava (o primeiro que entra como anfitrião). Além do grant por coluna (a equipe só muda
-- `status`), o trigger devolve o valor antigo em qualquer mudança desses campos feita por alguém logado que não é
-- admin (inclusive limpar). Servidor (sem auth.uid()) e admin passam: é o que deixa o `on delete set null` funcionar.
create or replace function public.proteger_anfitriao() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.eh_admin()
     and (new.anfitriao_id is distinct from old.anfitriao_id or new.anfitriao_entrou_em is distinct from old.anfitriao_entrou_em) then
    new.anfitriao_id := old.anfitriao_id;
    new.anfitriao_entrou_em := old.anfitriao_entrou_em;
  end if;
  return new;
end $$;
create trigger sessoes_proteger_anfitriao before update on public.sessoes for each row execute function public.proteger_anfitriao();

create or replace function public.marcar_anfitriao(p_sessao uuid, p_usuario uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare linhas int;
begin
  update sessoes set anfitriao_id = p_usuario, anfitriao_entrou_em = now() where id = p_sessao and anfitriao_id is null;
  get diagnostics linhas = row_count;
  return linhas > 0;
end $$;
revoke all on function public.marcar_anfitriao(uuid, uuid) from public, anon, authenticated;
grant execute on function public.marcar_anfitriao(uuid, uuid) to service_role;

-- Fila dos avisos pro vendedor (WhatsApp pelo CRM, URL única em configuracao.crm_url_equipe) -----------------
create table public.avisos_equipe (
  id uuid primary key default gen_random_uuid(),
  id_evento text not null unique,
  evento text not null check (evento in ('vendedor_novo_agendamento', 'vendedor_sessao_em_breve', 'vendedor_resumo_diario')),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  sessao_id uuid references public.sessoes(id) on delete cascade,
  inscricao_id uuid references public.inscricoes(id) on delete cascade,
  agenda_id uuid references public.agendas(id) on delete cascade,
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
create index avisos_equipe_fila on public.avisos_equipe (status, proxima_em);
create index avisos_equipe_usuario on public.avisos_equipe (usuario_id);
create trigger avisos_equipe_updated_at before update on public.avisos_equipe for each row execute function public.tocar_updated_at();
alter table public.avisos_equipe enable row level security;
create policy admin_le on public.avisos_equipe for select to authenticated using (public.eh_admin());

-- Enfileira sem duplicar pelo id_evento (mesma ideia do enfileirar_evento).
create or replace function public.enfileirar_aviso_equipe(
  p_id_evento text, p_evento text, p_usuario uuid, p_sessao uuid, p_agenda uuid, p_corpo jsonb, p_sem_destino boolean,
  p_inscricao uuid default null
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare linhas int;
begin
  insert into avisos_equipe (id_evento, evento, usuario_id, sessao_id, inscricao_id, agenda_id, corpo, status)
  values (p_id_evento, p_evento, p_usuario, p_sessao, p_inscricao, p_agenda, p_corpo, case when p_sem_destino then 'sem_destino' else 'pendente' end)
  on conflict (id_evento) do nothing;
  get diagnostics linhas = row_count;
  return linhas > 0;
end $$;
revoke all on function public.enfileirar_aviso_equipe(text, text, uuid, uuid, uuid, jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function public.enfileirar_aviso_equipe(text, text, uuid, uuid, uuid, jsonb, boolean, uuid) to service_role;

-- Reivindica com lease de 2 minutos (mesma ideia do reivindicar_eventos).
create or replace function public.reivindicar_avisos_equipe(p_limite int, p_agora timestamptz) returns setof avisos_equipe
language sql security definer set search_path = public, pg_temp as $$
  update avisos_equipe set proxima_em = p_agora + interval '2 minutes'
  where id in (
    select id from avisos_equipe where status = 'pendente' and proxima_em <= p_agora order by proxima_em limit p_limite for update skip locked
  )
  returning *;
$$;
revoke all on function public.reivindicar_avisos_equipe(int, timestamptz) from public, anon, authenticated;
grant execute on function public.reivindicar_avisos_equipe(int, timestamptz) to service_role;

-- O que vai junto ao excluir: igual à 20261023170000_dashboard.sql, mas o membro só conta agenda/sessão dele.
create or replace function public.contar_dependencias(p_tipo text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_sessoes int := 0; v_inscritos int := 0; v_gravacoes int := 0; v_avisos int := 0; v_vendas int := 0;
begin
  if auth.uid() is not null and not eh_membro() then raise exception 'acesso negado' using errcode = '42501'; end if;
  -- Membro (não admin) só conta agenda/sessão que ele vê (as dele).
  if auth.uid() is not null and (
    (p_tipo = 'agenda' and not pode_ver_agenda(p_id)) or (p_tipo = 'sessao' and not pode_ver_sessao(p_id))
  ) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
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
