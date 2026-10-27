-- Transcrição da call (etapa 1): a chave por agenda e a marca da sessão cuja meeting nasceu com transcrição em pt-BR.
-- O RealtimeKit transcreve quem entra com preset `transcription_enabled`, e o idioma vem do `ai_config` da meeting
-- (sem ele, sai em inglês). Por isso a sala só usa os presets `_transcricao` quando a meeting da sessão foi criada com
-- o `ai_config` (`rtk_transcreve`) E a agenda continua com `transcrever` ligado (src/lib/sala.ts, meetingDaSessao).
alter table public.agendas add column transcrever boolean not null default false;
alter table public.sessoes add column rtk_transcreve boolean not null default false;

-- Leitura de agendas pelo cliente da equipe é por coluna (migração 20261023200000_vendedor.sql): o editor lê a nova.
grant select (transcrever) on public.agendas to authenticated;
