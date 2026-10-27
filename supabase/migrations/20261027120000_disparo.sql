-- Disparo pela API oficial do WhatsApp (ferramenta de disparo): 2º destino dos avisos que mandam mensagem pro lead. O CRM continua
-- recebendo os eventos da agenda (move o negócio no Kanban); a URL de disparo recebe só os que viram mensagem
-- (agendou, lembretes, começou e faltou). Cada destino é uma linha própria na fila (`destino`), com tentativas e
-- situação próprias: se um cair, o outro segue.
alter table public.agendas add column disparo_url text;

alter table public.eventos add column destino text not null default 'crm' check (destino in ('crm', 'disparo'));
-- A equipe lê `eventos` por coluna (20261024120000_permissoes.sql): a coluna nova entra na lista.
grant select (destino) on public.eventos to authenticated;

-- Mesma função, com o destino da linha (padrão `crm`, como antes).
drop function public.enfileirar_evento(text, text, uuid, uuid, uuid, jsonb, boolean);
create function public.enfileirar_evento(
  p_id_evento text, p_evento text, p_inscricao uuid, p_sessao uuid, p_agenda uuid, p_corpo jsonb, p_sem_destino boolean,
  p_destino text default 'crm'
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare linhas int;
begin
  insert into eventos (id_evento, evento, inscricao_id, sessao_id, agenda_id, corpo, status, destino)
  values (p_id_evento, p_evento, p_inscricao, p_sessao, p_agenda, p_corpo, case when p_sem_destino then 'sem_destino' else 'pendente' end, p_destino)
  on conflict (id_evento) do nothing;
  get diagnostics linhas = row_count;
  return linhas > 0;
end $$;
revoke all on function public.enfileirar_evento(text, text, uuid, uuid, uuid, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.enfileirar_evento(text, text, uuid, uuid, uuid, jsonb, boolean, text) to service_role;
