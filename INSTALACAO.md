# Instalação do Vórtex Call (passo a passo manual)

Este guia instala o Vórtex Call do zero, nas suas contas. Prefere que o Claude Code faça com você? Use o
[PROMPT-DE-INSTALACAO.md](PROMPT-DE-INSTALACAO.md). Os dois seguem a mesma ordem.

Tempo estimado: 1 a 2 horas na primeira vez.

---

## 1. Contas

| Conta | Pra quê | Tem plano grátis? |
|---|---|---|
| [GitHub](https://github.com) | Guardar a sua cópia do código | Sim |
| [Supabase](https://supabase.com) | Banco de dados e login da equipe | Sim (o projeto grátis pausa depois de 7 dias sem uso; pra uso diário de empresa, avalie o Pro) |
| [Vercel](https://vercel.com) | Colocar o sistema no ar (hospedagem) | Sim (Hobby), mas: o Hobby é pra uso não comercial e **não roda rotina de 1 em 1 minuto**. Pra empresa, a Vercel pede o Pro (pago). No Hobby, use o agendador do Supabase (passo 7.3) |
| [Cloudflare](https://dash.cloudflare.com) | A sala de vídeo (RealtimeKit) e, se quiser, guardar as gravações (R2) | A conta é grátis. O RealtimeKit cobra por uso (minutos de participante): confira o preço atual na página do RealtimeKit na documentação da Cloudflare. O R2 tem uma faixa grátis mensal de armazenamento |
| [OpenRouter](https://openrouter.ai) (opcional) | IA que resume a ficha do lead e o que foi alinhado na call | Pago por uso (você coloca crédito) |
| Seu CRM (opcional) | Mandar as mensagens de WhatsApp (agendou, lembretes, faltou) | Depende do CRM. Precisa aceitar **webhook** (ver `docs/avisos-crm.md`) |

Você também vai precisar, no computador: **Node.js 20 ou mais novo** ([nodejs.org](https://nodejs.org)) e **Git**
([git-scm.com](https://git-scm.com)). Os programas da Supabase e da Vercel rodam com `npx` (não precisa instalar).

---

## 2. Baixar o código

No terminal, numa pasta onde você guarda projetos:

```bash
git clone https://github.com/matheustillimt-tech/vortex-call.git
cd vortex-call
npm install
cp .env.example .env.local
```

O arquivo `.env.local` guarda as suas chaves. Ele **nunca** vai pro GitHub (o `.gitignore` já impede). Abra no seu
editor e vá preenchendo conforme os próximos passos.

Gere já os dois segredos internos (cole cada resultado na linha certa do `.env.local`):

```bash
openssl rand -hex 32   # → CRON_SECRET
openssl rand -hex 32   # → CRYPTO_KEY
```

---

## 3. Banco de dados (Supabase)

1. Em [supabase.com](https://supabase.com), **New project**. Escolha a região **South America (São Paulo)** e anote a
   senha do banco (você vai digitar no terminal).
2. Em **Project Settings → API Keys** (aba "Legacy API Keys", se aparecer), copie:
   - `anon` / `public` → `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` no `.env.local` (a URL fica em
     **Project Settings → Data API** ou no botão **Connect**);
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY`. Essa é **secreta**: dá acesso total ao banco.
3. Aplique o banco (as tabelas e regras de segurança ficam em `supabase/migrations/`, aplicadas em ordem):

   ```bash
   npx supabase login
   npx supabase init        # só se ainda não existir supabase/config.toml (responda "n" às perguntas de editor)
   npx supabase link --project-ref SEU-REF
   npx supabase db push
   ```

   O `SEU-REF` é o código do projeto: aparece no endereço do painel (`supabase.com/dashboard/project/SEU-REF`). O
   `link` pede a senha do banco: digite no terminal.
4. **Feche o cadastro aberto:** em **Authentication → Sign In / Providers**, desligue **"Allow new users to sign up"**.
   Quem entra no painel é só quem um administrador cadastra na tela Equipe.

Este sistema não usa Edge Functions nem segredos do Supabase (`supabase secrets set`): tudo roda na Vercel.

---

## 4. Sala de vídeo (Cloudflare RealtimeKit)

1. Crie (ou entre) na sua conta da [Cloudflare](https://dash.cloudflare.com). Copie o **Account ID** (aparece na
   página inicial da conta, à direita, ou em qualquer página de "Overview") → `CLOUDFLARE_ACCOUNT_ID`.
2. No painel, abra **Realtime → RealtimeKit** e crie um app (nome sugerido: `vortex-call`). Copie o **App ID** →
   `REALTIMEKIT_APP_ID`.
3. Em **My Profile → API Tokens → Create Token → Custom token**, dê a permissão de conta **Realtime** (ou
   "Realtime Admin") com acesso **Edit**, limitado à sua conta. Copie o token → `CLOUDFLARE_API_TOKEN`.
4. Os perfis da sala (anfitrião, convidado, espião, participante) e o webhook do RealtimeKit são criados por um
   comando, **depois** que o sistema estiver no ar (passo 7.5).

### Gravações no seu R2 (opcional, recomendado)

Sem isso, as gravações ficam **7 dias** no armazenamento da Cloudflare e depois somem.

1. No painel da Cloudflare, **R2 → Create bucket** (nome sugerido: `vortex-call-gravacoes`) → `R2_BUCKET`.
2. **R2 → Manage API Tokens → Create API Token**, permissão **Object Read & Write**, só nesse bucket. Copie o
   **Access Key ID** → `R2_ACCESS_KEY_ID` e o **Secret Access Key** → `R2_SECRET_ACCESS_KEY`.

As gravações vão pra pasta `gravacoes/` do bucket. O painel gera um link assinado de 1 hora pra assistir ou baixar.

---

## 5. Todas as variáveis

| Nome | Pra que serve | Onde pegar | Obrigatória? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Endereço do banco | Supabase → Project Settings → Data API | Sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública do banco (login da equipe) | Supabase → Project Settings → API Keys (`anon`) | Sim |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta do banco (servidor) | Supabase → Project Settings → API Keys (`service_role`) | Sim |
| `NEXT_PUBLIC_SITE_URL` | Endereço público do sistema, sem barra no fim (vai nos links do lead) | O endereço da Vercel ou o seu domínio | Sim |
| `CRON_SECRET` | Protege as rotinas automáticas `/api/cron/*` | `openssl rand -hex 32` | Sim |
| `CRYPTO_KEY` | Embaralha o IP no limite contra robô | `openssl rand -hex 32` | Sim |
| `CLOUDFLARE_ACCOUNT_ID` | Conta da Cloudflare | Painel da Cloudflare | Sim |
| `CLOUDFLARE_API_TOKEN` | Acesso ao RealtimeKit | Cloudflare → My Profile → API Tokens | Sim |
| `REALTIMEKIT_APP_ID` | O app da sala | Cloudflare → Realtime → RealtimeKit | Sim |
| `NEXT_PUBLIC_EMPRESA_NOME` | Nome da sua empresa nos textos fixos (agenda do Google, aba da sala, IA) | Você escolhe | Não |
| `IA_SOBRE_A_EMPRESA` | Uma frase sobre o que você vende, pra IA entender as calls | Você escreve | Não |
| `TRANSCRICAO_PALAVRAS` | Palavras que a transcrição deve reconhecer (separadas por vírgula) | Você escreve | Não |
| `OPENROUTER_API_KEY` | IA (resumo da ficha e da call) | openrouter.ai → Keys | Não (sem ela, sem resumos) |
| `OPENROUTER_TEXT_MODEL` | Qual modelo de IA usar (id `empresa/modelo`; vários separados por vírgula) | openrouter.ai/models | Não (junto com a de cima) |
| `R2_ACCESS_KEY_ID` | Gravações no seu R2 | Cloudflare → R2 → API Tokens | Não |
| `R2_SECRET_ACCESS_KEY` | Gravações no seu R2 | Cloudflare → R2 → API Tokens | Não |
| `R2_BUCKET` | Nome do bucket das gravações | Cloudflare → R2 | Não |
| `PAY_WEBHOOK_TOKEN` | Liga o webhook de vendas (`docs/vendas-webhook.md`) | `openssl rand -hex 24` | Não |
| `COR_MARCA` | Cor dos botões da sala, usada só pelo `npm run rtk:setup` | Você escolhe (hex) | Não (padrão `#0a8452`) |

Confira se compila: `npm run build` (e, se quiser, `npm test`, que roda os testes sem precisar de internet).

---

## 6. Publicar na Vercel

### 6.1 Escolha o plano

- **Vercel Pro:** deixe o `vercel.json` como está. Ele já agenda as duas rotinas de 1 em 1 minuto
  (`/api/cron/tick`: avisos, lembretes, presença, limpeza; `/api/cron/resumos`: resumo da call pela IA).
- **Vercel Hobby (grátis):** antes de publicar, apague o bloco `"crons": [...]` do `vercel.json` (deixe só
  `{ "regions": ["gru1"] }`). Senão a publicação falha. As rotinas vão rodar pelo Supabase (passo 7.3).

### 6.2 Pelo site (com o seu GitHub)

1. Crie um repositório **privado** no seu GitHub e suba o código pra ele (o `git clone` deixou o endereço do repositório
   original; troque com `git remote set-url origin https://github.com/SEU-USUARIO/SEU-REPO.git` e `git push -u origin main`).
2. Na Vercel, **Add New → Project → Import** o seu repositório. Framework: Next.js (detectado sozinho).
3. Em **Environment Variables**, cadastre todas as variáveis que você preencheu no `.env.local`.
4. **Deploy.** Ao terminar, copie o endereço (ex.: `https://seu-projeto.vercel.app`).

Daqui pra frente, **todo push na `main` publica sozinho**.

### 6.3 Ou pelo terminal

```bash
npx vercel link                              # cria/liga o projeto
npx vercel env add NOME_DA_VARIAVEL production  # repita pra cada variável (o valor você cola no terminal)
npx vercel --prod                            # publica
```

### 6.4 Endereço final

Atualize `NEXT_PUBLIC_SITE_URL` com o endereço final (o `.vercel.app` ou o seu domínio próprio, em
**Settings → Domains**) no `.env.local` **e** na Vercel, e publique de novo. Os links que vão pro lead usam esse
endereço.

Se usar a Cloudflare como DNS do seu domínio, deixe o registro **só DNS (nuvem cinza)**: com o proxy ligado, todos os
leads chegariam com o mesmo IP e bateriam no limite contra robô.

---

## 7. Depois de publicar

### 7.1 Criar o primeiro administrador

1. No Supabase, **Authentication → Users → Add user → Create new user**: seu e-mail, uma senha e marque
   **Auto Confirm User**.
2. No **SQL Editor** do Supabase, rode (trocando nome e e-mail):

   ```sql
   insert into public.usuarios (auth_id, nome, email, papel)
   select id, 'Seu Nome', email, 'admin' from auth.users where email = 'voce@exemplo.com';
   ```

3. Entre no painel (`/login`) com esse e-mail e senha. O resto da equipe você cadastra na tela **Equipe** (admin).

### 7.2 Configurações

Na tela **Configurações**: nome da empresa, link do logo, cor e WhatsApp de suporte. É o que aparece pro lead na sala
e na página de agendamento.

### 7.3 Rotinas automáticas no plano grátis da Vercel

Só se você apagou o bloco `crons` do `vercel.json`. No **SQL Editor** do Supabase, siga o arquivo
`supabase/opcional/cron-pelo-supabase.sql`: primeiro guarda no **Vault** (cofre de segredos do Supabase) o endereço
do sistema e o mesmo valor do `CRON_SECRET`, depois agenda as duas rotinas de 1 em 1 minuto.

### 7.4 Conferir as rotinas

A rotina `/api/cron/tick` responde 401 sem o segredo (é o esperado). Pra testar na mão:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://seu-dominio.com.br/api/cron/tick
```

(com `CRON_SECRET` exportado no terminal). Deve voltar um JSON com contadores.

### 7.5 Perfis da sala e webhook do RealtimeKit

Com o `.env.local` apontando `NEXT_PUBLIC_SITE_URL` pro endereço publicado, rode:

```bash
npm run rtk:setup
```

Ele cria (ou atualiza) os perfis `vortex_anfitriao`, `vortex_convidado`, `vortex_espiao`, `vortex_participante` (e
os `_transcricao`) e o webhook `https://seu-dominio.com.br/api/webhooks/realtimekit`, que avisa presença, fim da call,
gravação pronta e transcrição. Rode de novo sempre que mudar `src/lib/regras/presets.ts` ou o endereço.

---

## 8. Integrações

- **WhatsApp pelo seu CRM (avisos pro lead e pra equipe):** `docs/avisos-crm.md`. Cada agenda tem o cartão
  "Avisos pro CRM (webhooks)" no editor; os avisos pro vendedor ficam em Configurações.
- **Vendas (quem comprou depois da call):** `docs/vendas-webhook.md` + variável `PAY_WEBHOOK_TOKEN`.
- **Encaixar a agenda no seu site ou formulário:** `docs/encaixar-agendamento.md`.
- **API REST e MCP (Claude conectado ao sistema):** tela **Integrações** (admin) + `docs/api.md`.
- **IA:** `OPENROUTER_API_KEY` + `OPENROUTER_TEXT_MODEL`. Pra transcrever e resumir as calls de uma agenda, ligue
  "Transcrever e resumir a call" no editor da agenda (o aviso "Esta call é transcrita" aparece na sala pra todos).

---

## 9. Checklist de teste

- [ ] Entrar em `/login` com o administrador.
- [ ] Preencher **Configurações** (nome, logo, cor).
- [ ] Criar uma **agenda** (endereço, duração, vagas) e uma **sessão** pra daqui a pouco (ou uma repetição semanal).
- [ ] Abrir `/agendar/ENDERECO-DA-AGENDA` numa janela anônima, agendar com um WhatsApp seu e guardar o link pessoal.
- [ ] Ver a pessoa na página da sessão (**Sessões**).
- [ ] Na hora, entrar na sala da equipe como **anfitrião** (botão na sessão) e, no celular, pelo link pessoal do lead.
- [ ] Clicar no nome do lead e ver a **ficha**; gravar alguns segundos; encerrar a sessão.
- [ ] Ver a gravação em **Gravações** (pode levar alguns minutos).
- [ ] Criar uma **reunião instantânea** ("Reunião agora") e abrir o link em outra aba.
- [ ] (Com CRM) usar o **"Enviar teste"** de cada aviso no editor da agenda.
- [ ] (Com IA) abrir a ficha e gerar o resumo.
- [ ] Conferir no **Início** (dashboard) os números da sessão de teste.

---

## 10. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Variável de ambiente ausente: X" | Falta a variável X na Vercel (ou no `.env.local`). Cadastre e publique de novo |
| Entrei no painel e aparece "Seu acesso ainda não foi liberado" | O usuário existe no login mas não na tabela `usuarios`. Rode o SQL do passo 7.1 |
| A publicação na Vercel falha falando de cron | Conta Hobby: apague o bloco `crons` do `vercel.json` (passo 6.1) |
| Lembretes e "faltou" não saem | As rotinas não estão rodando: confira os crons da Vercel (Pro) ou `select * from cron.job_run_details order by start_time desc limit 10;` no Supabase (Hobby). Confira também o `CRON_SECRET` igual nos dois lados |
| A sala não abre / erro do RealtimeKit | Confira `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (permissão Realtime) e `REALTIMEKIT_APP_ID`, e se rodou `npm run rtk:setup` |
| Presença, "compareceu/faltou" ou gravação não atualizam | O webhook do RealtimeKit não chega: rode `npm run rtk:setup` com o `NEXT_PUBLIC_SITE_URL` publicado (não `localhost`) |
| Gravação some depois de 7 dias | Configure o R2 (`R2_*`) |
| `supabase link` reclama de `config.toml` | Rode `npx supabase init` antes (passo 3) |
| `supabase db push` dá "Invalid access token" | Rode `npx supabase login` de novo |
| Muitos leads recebem "limite" ao agendar | Proxy da Cloudflare ligado no domínio: deixe o registro só DNS (nuvem cinza) |
| O resumo da IA não aparece | Faltam `OPENROUTER_API_KEY` e `OPENROUTER_TEXT_MODEL`, ou a call teve menos de 3 minutos de conversa |
