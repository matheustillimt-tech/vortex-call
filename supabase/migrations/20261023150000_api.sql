-- Etapa 6 (Tarefa 1): chaves de acesso da API REST (/api/v1/*) e do MCP (POST /api/mcp).
-- Formato da chave `vc_` + 40 caracteres base62. O banco guarda só o prefixo (8 primeiros depois de `vc_`) e o
-- SHA-256 hex da chave inteira; a chave em texto aparece uma vez, na criação. `leitura` só consulta (GET);
-- `escrita` também grava (POST). Só admin cria/revoga. Só o servidor (service role) lê e grava estas tabelas.

create table public.chaves_api (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 1 and 60),
  permissao text not null check (permissao in ('leitura', 'escrita')),
  prefixo text not null,
  hash text not null unique,
  criada_por uuid references public.usuarios(id) on delete set null,
  ultimo_uso timestamptz,
  revogada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger chaves_api_updated_at before update on public.chaves_api
  for each row execute function public.tocar_updated_at();

alter table public.chaves_api enable row level security;
revoke all on public.chaves_api from anon, authenticated;

-- Contador de chamadas por chave e minuto (limite de 120 por minuto, conferido no servidor).
create table public.api_uso (
  chave_id uuid not null references public.chaves_api(id) on delete cascade,
  minuto timestamptz not null,
  chamadas integer not null default 0 check (chamadas >= 0),
  primary key (chave_id, minuto)
);

alter table public.api_uso enable row level security;
revoke all on public.api_uso from anon, authenticated;

-- Soma uma chamada no minuto atual da chave e devolve o total do minuto; marca o último uso e limpa os minutos com
-- mais de uma hora (da mesma chave). `security invoker`, `search_path` travado; só o servidor chama.
create or replace function public.api_registrar_uso(p_chave uuid) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_total integer;
begin
  insert into public.api_uso (chave_id, minuto, chamadas)
  values (p_chave, date_trunc('minute', now()), 1)
  on conflict (chave_id, minuto) do update set chamadas = public.api_uso.chamadas + 1
  returning chamadas into v_total;
  update public.chaves_api set ultimo_uso = now() where id = p_chave;
  delete from public.api_uso where chave_id = p_chave and minuto < now() - interval '1 hour';
  return v_total;
end;
$$;

revoke execute on function public.api_registrar_uso(uuid) from public, anon, authenticated;
grant execute on function public.api_registrar_uso(uuid) to service_role;
