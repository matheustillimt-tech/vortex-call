-- Evento novo `comprou` pro CRM: venda aprovada (webhook de pagamento) ligada a uma inscrição move o negócio pra
-- "Comprou" com o valor (src/lib/vendas.ts → avisarCompra). Nada pro WhatsApp do lead.
alter table public.eventos drop constraint eventos_evento_check;
alter table public.eventos add constraint eventos_evento_check
  check (evento in ('agendou', 'lembrete_24h', 'lembrete_1h', 'comecou', 'faltou', 'compareceu', 'resumo', 'comprou'));
