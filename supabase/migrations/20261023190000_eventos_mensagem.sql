-- Mensagem de WhatsApp pronta (IA ou texto fixo) que vai no campo `mensagem` do evento pro CRM. Nasce na
-- entrega (não ao enfileirar) e fica guardada aqui: o reenvio depois de uma falha manda o mesmo texto, sem chamar a
-- IA de novo. Nula = ainda não gerada. `reivindicar_eventos` devolve a linha inteira, então já traz a coluna.
alter table public.eventos add column mensagem text;
