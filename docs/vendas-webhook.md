# Vendas por webhook: ligar as compras às calls

Se você vende por uma plataforma de pagamento que avisa cada compra por **webhook** (um `POST` com JSON pra um
endereço seu), ela pode avisar o Vórtex Call. Ele liga a venda à pessoa que assistiu a call e mostra isso no
dashboard (quem comprou, quanto e em qual call), além de mandar o evento `comprou` pro seu CRM
(ver `docs/avisos-crm.md`).

**Formato aceito:** o do webhook da **Kiwify** (campos `webhook_event_type`, `order_id`, `order_status`,
`Commissions.charge_amount`, `Customer.email`/`mobile`, `Product.product_name`, `created_at`). Se a sua plataforma usa
esse formato (ou permite montar o corpo nesse formato), funciona direto. Se usa outro, dá pra adaptar só um arquivo:
`src/lib/regras/venda-pay.ts` (função `normalizarVendaPay`), que traduz o corpo do webhook pro formato interno. Peça
ao Claude Code: "adapta o `normalizarVendaPay` pro webhook da minha plataforma" e cole um exemplo do JSON que ela manda
(sem dados reais de cliente).

O que o Vórtex Call entende:

- **Compra aprovada:** `webhook_event_type = "compra_aprovada"` com `order_status = "paid"` (soma no dashboard).
- **Reembolso:** `webhook_event_type = "compra_reembolsada"` com `order_status = "refunded"` (a venda é marcada como
  reembolsada e sai das contas de receita).
- Qualquer outro evento (Pix gerado, recusada, chargeback…) é ignorado (responde 200 pra plataforma não reenviar).

## Passo 1: criar o token

O token é uma senha longa que vai no próprio endereço do webhook. Gere um texto aleatório longo (por exemplo, com
`openssl rand -hex 24` no terminal) e cadastre na variável de ambiente `PAY_WEBHOOK_TOKEN` (no `.env.local` e na
Vercel). Sem essa variável, a rota responde 404 e nenhuma venda entra.

## Passo 2: cadastrar a URL na plataforma de pagamento

No cadastro de webhook da sua plataforma, use este endereço (trocando o domínio e `<TOKEN>` pelo valor do Passo 1):

```
https://seu-dominio.com.br/api/webhooks/pay/<TOKEN>
```

O token fica na própria URL (não precisa configurar cabeçalho nem segredo separado). Marque o evento de **compra
aprovada** e, se existir, o de **reembolso**.

## Cuidado com "Reenviar" e "Testar" na plataforma

- **"Reenviar webhooks"** costuma mandar de novo pra todos os sistemas cadastrados, não só pro Vórtex Call: pode
  gerar efeito duplicado nos outros.
- **"Testar"** em geral manda uma venda **fake** (com comprador fictício). O Vórtex Call não sabe que é teste: ela
  entra como venda de verdade, aparece no dashboard e pode ficar ligada a um lead de verdade se o telefone ou e-mail
  de teste bater.

## Passo 3: conferir que as vendas estão chegando

Depois de cadastrar, espere a primeira venda de verdade e confira no painel: dashboard (cartões "Compraram" e
Receita) e página da sessão (colunas "comprou" e "valor"). Se a venda não aparecer em alguns minutos, confira o token
(igual nos dois lados) e a URL cadastrada.

## Como a venda é ligada à pessoa

O Vórtex Call procura quem comprou pelo WhatsApp (ou, se não bater, pelo e-mail) entre as pessoas que **assistiram**
alguma call nos **7 dias antes da compra**. Sem ninguém batendo, a venda fica guardada do mesmo jeito, só sem
aparecer ligada a uma call.
