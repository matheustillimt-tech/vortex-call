-- Janela de agendamento por agenda: o lead só vê (e só agenda) as sessões dos primeiros N dias, no calendário de
-- Brasília a partir de hoje, que ainda têm horário agendável. Null = sem limite (como antes). A regra mora em
-- src/lib/regras/janela.ts (filtrarJanela) e é aplicada na vitrine pública e na rota de inscrever.
alter table public.agendas add column janela_dias int null
  constraint agendas_janela_dias_faixa check (janela_dias between 1 and 60);

-- Leitura de agendas pelo cliente da equipe é por coluna (migração 20261023200000_vendedor.sql): o editor lê a nova.
grant select (janela_dias) on public.agendas to authenticated;
