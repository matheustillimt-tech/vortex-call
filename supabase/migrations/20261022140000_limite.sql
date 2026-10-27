-- Contagem atômica de limite por janela de 1 min (evita a corrida leitura-depois-escrita de before/after).
create or replace function public.contar_limite(p_chave text, p_janela timestamptz)
returns int
language sql security definer set search_path = public, pg_temp as $$
  insert into limites (chave, janela, total) values (p_chave, p_janela, 1)
  on conflict (chave, janela) do update set total = limites.total + 1
  returning total
$$;

revoke all on function public.contar_limite(text, timestamptz) from public, anon, authenticated;
grant execute on function public.contar_limite(text, timestamptz) to service_role;
