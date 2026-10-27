# CLAUDE.md: Vórtex Call

Guia pro Claude Code mexer neste template. Quem usa normalmente é dono de negócio, não programador: explique em
português simples, faça uma coisa de cada vez e peça OK antes de publicar, apagar ou mexer no banco de produção.

## O que é

Videochamada de vendas: agendas públicas (`/agendar/{slug}` e o módulo `agendar.js` pra encaixar em outra página),
link pessoal do lead (`/c/{codigo}`, com sala de espera), sala de vídeo (Cloudflare RealtimeKit) com a coluna da ficha
do lead pra equipe (`/equipe/sala/{sessao}`), reunião instantânea (`/r/{codigo}`, 24 h), link de convidado
(`/s/{codigo}`), avisos por webhook pro CRM (fila `eventos`) e pro vendedor (fila `avisos_equipe`), gravações (R2),
transcrição e resumo da call por IA (OpenRouter), dashboard de vendas, API REST (`/api/v1/*`) e servidor MCP
(`/api/mcp`).

## Onde está cada coisa

| O quê | Onde |
|---|---|
| Painel da equipe (telas) | `app/(painel)/` (`_componentes/` = UI compartilhada) |
| Sala de vídeo | `app/_sala/` (barra, palco, chat, dispositivos, gravação) |
| Sala da equipe + ficha + transcrição | `app/equipe/sala/[sessao]/` |
| Páginas públicas | `app/agendar/`, `app/agendar.js/`, `app/c/`, `app/r/`, `app/s/`, `app/login/` |
| Rotas | `app/api/` (`cron/tick` e `cron/resumos` = rotinas de 1 em 1 minuto; `webhooks/realtimekit`; `webhooks/pay/[token]`; `v1/*`; `mcp`) |
| Regras puras (testadas, sem banco) | `src/lib/regras/` |
| Acesso a banco, RealtimeKit, R2, IA | `src/lib/*.ts`, `src/lib/supabase/`, `src/lib/api/`, `src/lib/mcp/` |
| Quem pode o quê | `src/lib/acesso.ts`, `src/lib/regras/permissoes.ts` (espelho do SQL `permissao_padrao`) |
| Banco | `supabase/migrations/` (em ordem); `supabase/opcional/cron-pelo-supabase.sql` (rotinas no plano grátis da Vercel) |
| Perfis da sala e webhook do RealtimeKit | `src/lib/regras/presets.ts` + `npm run rtk:setup` (`scripts/realtimekit-setup.ts`) |
| Variáveis | `.env.example` (todas, com comentário); leitura em `src/lib/env.ts` |
| Guias | `README.md`, `INSTALACAO.md`, `docs/` |

## Como rodar

```bash
npm install
cp .env.example .env.local   # preencher (ver INSTALACAO.md)
npm run dev                  # http://localhost:3000
npm test                     # Vitest + PGlite (Postgres em memória): roda sem internet
npm run typecheck
npm run build
```

O build passa mesmo sem `.env.local`; as variáveis obrigatórias só são cobradas quando a rota roda.

## Como personalizar

- **Marca na sala e no agendamento** (nome, logo, cor, WhatsApp de suporte): tela **Configurações** (tabela
  `configuracao`), sem mexer no código.
- **Nome da empresa nos textos fixos:** `NEXT_PUBLIC_EMPRESA_NOME` (`src/lib/regras/marca.ts`). Frase pra IA:
  `IA_SOBRE_A_EMPRESA`. Palavras da transcrição: `TRANSCRICAO_PALAVRAS`.
- **Nome do produto "Vórtex Call" e cor do painel:** `app/layout.tsx` (título), `app/(painel)/_componentes/logo.tsx`
  e `menu.tsx`, os `metadata` das páginas; cor do painel no bloco "Marca" de `app/globals.css`; cor da sala pelo
  `COR_MARCA` + `npm run rtk:setup`.
- **Textos do WhatsApp pro lead:** `src/lib/regras/mensagem.ts` (`mensagemPadrao`; a call se chama "diagnóstico" ou
  "apresentação" em `nomeDaCall`). Pro vendedor: `src/lib/regras/avisos-equipe.ts`. Mudou texto: rode `npm test` e
  ajuste os testes que conferem o texto.
- **Pedidos pra IA:** `src/lib/regras/alinhamento.ts` (resumo da call) e `src/lib/regras/ficha.ts` (resumo da ficha).
- **Formato do webhook de vendas:** `src/lib/regras/venda-pay.ts` (`normalizarVendaPay`, hoje no formato da Kiwify).
- **Fuso:** o sistema trabalha em `America/Sao_Paulo` (constantes `FUSO` espalhadas e `src/lib/regras/fuso.ts`).

## Regras

- **Nunca** versionar `.env`, `.env.local` nem qualquer chave. Segredos só no `.env.local` e nas variáveis da Vercel.
  Nunca peça pra pessoa colar chave no chat: abra o `.env.local` pra ela ou use `npx vercel env add`.
- **Migração nova sempre no fim da fila:** arquivo novo em `supabase/migrations/` com data/hora maior que a última.
  Nunca edite uma migração que já foi aplicada no banco de alguém; crie outra. Aplicar: `npx supabase db push`.
- Coluna nova em `inscricoes`, `eventos` ou `agendas` precisa entrar no `grant select (...)` da equipe (a leitura é
  por coluna, ver `20261024120000_permissoes.sql`).
- A inscrição passa sempre pela função SQL `inscrever` (vaga atômica, uma inscrição ativa por WhatsApp por agenda).
- Rota nova que usa `dbAdmin()` (service role) depois de `membroApi`/`exigirMembro` tem que conferir acesso com
  `podeVerSessao`/`podeVerGravacao`/`exigirAcessoSessao` e a permissão com `pode()` (`src/lib/acesso.ts`).
- Tabelas sem leitura anônima: rotas públicas usam a service role no servidor e devolvem só o necessário.
- Datas gravadas em UTC, mostradas em `America/Sao_Paulo`. Telefone sempre em E.164 (`paraE164`).
- Mudou `src/lib/regras/presets.ts` ou o endereço do site: rode `npm run rtk:setup` de novo.
- **Push na `main` pode publicar** se o repositório estiver ligado na Vercel. Confirme com a pessoa antes de
  `git push` e antes de qualquer `npx vercel --prod`.
- Rode `npm test` e `npm run build` antes de dizer que terminou.
