-- OPCIONAL. Rode só se a sua Vercel estiver no plano grátis (Hobby), que não aceita rotina de 1 em 1 minuto.
-- Este arquivo NÃO é uma migração (fica fora de supabase/migrations de propósito): cole no SQL Editor do Supabase.
--
-- O que faz: o próprio Supabase chama, a cada minuto, as duas rotinas do Vórtex Call (/api/cron/tick e
-- /api/cron/resumos), no lugar do bloco "crons" do vercel.json (que você apaga antes de publicar na Hobby).
--
-- Passo 1 (uma vez): guarde no Vault do Supabase o endereço do sistema e o mesmo valor do CRON_SECRET da Vercel.
-- Troque os dois textos entre aspas e rode só estas duas linhas (o valor fica guardado criptografado, fora do código):
--
--   select vault.create_secret('https://seu-dominio.com.br', 'vortex_call_site');
--   select vault.create_secret('cole-aqui-o-mesmo-valor-do-CRON_SECRET', 'vortex_call_cron_secret');
--
-- Passo 2: rode o resto do arquivo.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'vortex-call-tick',
  '* * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'vortex_call_site') || '/api/cron/tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'vortex_call_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

select cron.schedule(
  'vortex-call-resumos',
  '* * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'vortex_call_site') || '/api/cron/resumos',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'vortex_call_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Conferir: select jobname, schedule, active from cron.job;
-- Ver as últimas execuções: select * from cron.job_run_details order by start_time desc limit 10;
-- Desligar (se um dia mudar pra Vercel Pro e voltar o bloco "crons" do vercel.json):
--   select cron.unschedule('vortex-call-tick');
--   select cron.unschedule('vortex-call-resumos');
