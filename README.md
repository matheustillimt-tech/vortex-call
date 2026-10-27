# Vórtex Call

Videochamada de vendas própria: agenda pública de horários, call em grupo e reunião interna, sala de vídeo com a
ficha do lead pra equipe, avisos no WhatsApp pelo seu CRM, gravações e dashboard de vendas.

## O que ele faz

- **Agendas públicas:** cada agenda tem um endereço (`/agendar/sua-agenda`) onde o lead escolhe o horário e deixa nome
  e WhatsApp. Sessões avulsas ou repetidas toda semana, com limite de vagas e janela de dias.
- **Agenda dentro do seu site:** uma linha de código mostra os horários em qualquer página ou formulário seu.
- **Link pessoal do lead:** cada pessoa recebe um link só dela, com sala de espera, botão de adicionar na agenda do
  Google e opção de escolher outro horário.
- **Sala de vídeo:** call de vendas em grupo com anfitrião, convidados e modo "espião" (entra sem aparecer), chat,
  compartilhamento de tela, escolha de microfone e câmera e aviso sonoro quando um lead entra.
- **Ficha do lead na sala da equipe:** respostas do formulário, origem (UTMs), calls anteriores, observações e resumo
  por IA, sem sair da call.
- **Transcrição e resumo da call (opcional):** a IA registra o que foi alinhado (dor, combinado, objeções, próximo
  passo, temperatura do lead) durante e depois da call.
- **Reunião instantânea:** botão "Reunião agora" pra reunião interna, com link que vale 24 horas.
- **Link de convidado:** o anfitrião chama um sócio ou especialista pra call na hora, sem ocupar vaga.
- **Presença automática:** marca quem veio e quem faltou, quanto tempo ficou e quanto interagiu.
- **Avisos por webhook pro seu CRM:** agendou, lembrete 1 dia e 1 hora antes, começou, compareceu, faltou, resumo e
  comprou, com a mensagem de WhatsApp já pronta. Também avisa o vendedor (novo agendamento, call em 10 minutos e o
  resumo do dia às 8h).
- **Gravações:** grava a call e guarda no seu bucket da Cloudflare (R2), com link pra assistir e baixar.
- **Dashboard de vendas:** inscritos, quem veio, quem interagiu, quem comprou, receita, funil e números por vendedor.
- **Vendas por webhook:** liga cada compra à call que a pessoa assistiu.
- **Equipe com permissões:** administrador e vendedor (vê só as agendas dele), com chaves liga/desliga por pessoa.
- **API REST e MCP:** outros sistemas (e o Claude) podem listar agendas, criar sessões, ver inscritos, fichas,
  resumos e gravações, com chave de acesso.

## Como funciona

1. Você cria uma agenda no painel e os horários (sessões).
2. O lead agenda pela página pública (ou pelo módulo no seu site) e recebe o link pessoal da sala.
3. O sistema avisa o seu CRM em cada momento (agendou, lembretes, começou, faltou), e o CRM manda o WhatsApp.
4. Na hora, a equipe entra pela sala da equipe e vê a ficha de cada lead; o lead entra pelo link dele.
5. Depois da call, o sistema marca presença, guarda a gravação, resume a conversa (se ligado) e mostra tudo no
   dashboard, junto com as vendas que chegarem.

Rotinas automáticas rodam de 1 em 1 minuto (lembretes, presença, entrega dos avisos, limpeza).

## Com o que é feito

- **Next.js 15** (React 19, TypeScript, Tailwind 4): o site, o painel e a API, publicados na **Vercel**.
- **Supabase** (Postgres): banco de dados, login da equipe e regras de segurança por linha.
- **Cloudflare RealtimeKit:** a sala de vídeo (áudio, vídeo, chat, gravação, transcrição).
- **Cloudflare R2** (opcional): onde ficam as gravações.
- **OpenRouter** (opcional): a IA dos resumos.
- **Vitest + PGlite:** testes automáticos (inclusive do SQL) que rodam sem internet.

## De quais contas você precisa

| Conta | Pra quê | Custo |
|---|---|---|
| GitHub | Guardar o código | Grátis |
| Supabase | Banco e login | Tem plano grátis |
| Vercel | Colocar no ar | Tem plano grátis (Hobby), mas ele é pra uso não comercial e não roda rotina de 1 em 1 minuto: no Hobby, as rotinas rodam pelo Supabase (explicado no guia). Pra empresa, a Vercel pede o Pro |
| Cloudflare | Sala de vídeo (RealtimeKit) e gravações (R2) | Conta grátis; o RealtimeKit cobra por minuto de participante e o R2 tem faixa grátis mensal. Confira os preços atuais na Cloudflare |
| OpenRouter (opcional) | IA dos resumos | Pago por uso |
| Um CRM com webhook (opcional) | Mandar as mensagens de WhatsApp | Depende do CRM |

## Instalar com o Claude Code

Abra o Claude Code (aba **Code**) numa pasta vazia e cole o prompt abaixo. Ele confere os programas, baixa o código,
guia a criação de cada conta (uma de cada vez, esperando você), aplica o banco, publica e roda o checklist. Ele nunca
pede pra você colar chave ou senha no chat.

```text
Você vai instalar o Vórtex Call pra mim, do zero, nesta pasta vazia. O Vórtex Call é um sistema de videochamada de
vendas: agenda pública de horários, sala de vídeo (Cloudflare RealtimeKit), ficha do lead pra equipe, avisos por
webhook pro meu CRM, gravações, API, MCP e dashboard de vendas. Código: https://github.com/matheustillimt-tech/vortex-call

Eu não sou programador. Fale comigo em português simples, explique cada termo técnico na primeira vez e faça uma
coisa de cada vez, esperando eu responder antes de seguir.

REGRAS (siga sempre):
1. Nunca me peça pra colar chave, senha ou token aqui no chat. Quando precisar de um segredo, abra o arquivo
   .env.local pra mim no editor e diga em qual linha colar, ou rode no meu terminal um comando que me pede o valor
   (por exemplo "npx vercel env add NOME production"). Se eu colar um segredo no chat por engano, me avise pra gerar
   outro no serviço e trocar.
2. Uma conta de cada vez: diga qual conta criar, o link, onde clicar, e espere eu dizer "pronto".
3. Antes de qualquer comando que publica, apaga ou pode gerar cobrança, explique o que vai acontecer e peça meu OK.
4. Use o arquivo INSTALACAO.md do repositório como roteiro e consulte ele quando tiver dúvida.
5. Nunca coloque o .env.local no git.

PASSOS:
1. Pré-requisitos: confira se tenho Node.js 20 ou mais novo, Git e o terminal funcionando. Instale o que faltar (no
   Mac, pelo Homebrew; no Windows, pelo instalador oficial), explicando o que é cada coisa. Os programas da Supabase e
   da Vercel a gente usa por "npx supabase" e "npx vercel" (não precisa instalar à parte).
2. Baixe o código nesta pasta: git clone https://github.com/matheustillimt-tech/vortex-call.git . e depois npm install.
3. Contas, uma por vez, me esperando em cada uma: GitHub, Supabase, Vercel e Cloudflare. Me diga o que cada uma faz,
   se tem plano grátis e o que pode custar (ver a seção "Contas" do INSTALACAO.md). Pergunte se eu quero agora a IA
   (OpenRouter, pago por uso) e as gravações no meu próprio R2 da Cloudflare, ou se deixo pra depois.
4. Copie .env.example para .env.local e abra pra mim. Gere você mesmo CRON_SECRET e CRYPTO_KEY com
   "openssl rand -hex 32" escrevendo direto no arquivo (sem mostrar o valor no chat). Me guie a preencher as outras,
   uma por vez, dizendo onde pegar cada valor.
5. Banco: me ajude a criar o projeto no Supabase (região São Paulo). Depois rode "npx supabase login",
   "npx supabase init" se ainda não existir supabase/config.toml, "npx supabase link --project-ref <ref>" (o ref
   aparece no endereço do projeto e não é segredo; a senha do banco eu digito no terminal) e
   "npx supabase db push". Confira se as migrações subiram.
6. Segurança do login: me guie a desligar o cadastro aberto no Supabase (Authentication > Sign In / Providers >
   "Allow new users to sign up" desligado). Quem entra no painel é só quem o administrador cadastrar.
7. RealtimeKit: me guie a criar o app no painel da Cloudflare (Realtime > RealtimeKit) e o token da API com permissão
   de Realtime. Se eu quiser gravações no meu R2, me guie a criar o bucket e o token do R2.
8. Teste local: rode "npm run build" e diga se passou.
9. Publicar na Vercel: pergunte se a minha conta da Vercel é Pro ou grátis (Hobby).
   - Se for Hobby: apague o bloco "crons" do vercel.json (o plano grátis não roda rotina de 1 em 1 minuto) e, depois
     da publicação, me guie a rodar o arquivo supabase/opcional/cron-pelo-supabase.sql no SQL Editor do Supabase
     (os dois segredos dele eu digito lá, não aqui).
   - Rode "npx vercel link" (cria o projeto), cadastre cada variável do .env.local com "npx vercel env add NOME
     production" (eu colo o valor no terminal) e publique com "npx vercel --prod".
   - Com o endereço final (o .vercel.app ou o meu domínio), atualize NEXT_PUBLIC_SITE_URL no .env.local e na Vercel e
     publique de novo.
10. Rode "npm run rtk:setup" (cria os perfis da sala e o webhook do RealtimeKit apontando pro endereço publicado).
11. Primeiro administrador: me guie a criar meu usuário no Supabase (Authentication > Users > Add user, com
    "Auto Confirm User"; a senha eu digito lá) e me dê o SQL pronto, com o meu e-mail e nome, pra eu rodar no SQL
    Editor e virar admin (está no INSTALACAO.md, passo "Criar o primeiro administrador").
12. Rode comigo o checklist de teste do INSTALACAO.md: entrar no painel, preencher Configurações, criar uma agenda e
    uma sessão, agendar pelo link público, entrar na sala como lead e como anfitrião, conferir a gravação.
13. No fim, me mostre um resumo: endereço do painel, o que ficou ligado, o que ficou pra depois (CRM, vendas, IA) e
    onde está cada guia (docs/avisos-crm.md, docs/vendas-webhook.md, docs/api.md, docs/encaixar-agendamento.md).
```

Prefere fazer na mão? Siga o **[INSTALACAO.md](INSTALACAO.md)**.

## Guias

- [INSTALACAO.md](INSTALACAO.md): instalação passo a passo, variáveis, checklist e problemas comuns.
- [docs/avisos-crm.md](docs/avisos-crm.md): ligar os avisos de WhatsApp no seu CRM.
- [docs/vendas-webhook.md](docs/vendas-webhook.md): ligar as vendas da sua plataforma de pagamento.
- [docs/encaixar-agendamento.md](docs/encaixar-agendamento.md): mostrar a agenda dentro do seu site.
- [docs/api.md](docs/api.md): API REST e MCP.
- [docs/realtimekit-referencia.md](docs/realtimekit-referencia.md): anotações técnicas sobre o RealtimeKit.

## Estrutura de pastas

```
app/
  (painel)/        painel da equipe: Início (dashboard), Agendas, Sessões, Horários, Reuniões,
                   Gravações, Equipe, Integrações, Configurações
  _sala/           a sala de vídeo (barra, palco, chat, gravação)
  agendar/         página pública de agendamento; agendar.js = módulo pra encaixar no seu site
  c/  r/  s/       link pessoal do lead, reunião instantânea e link de convidado
  equipe/sala/     sala da equipe, com a coluna da ficha do lead
  api/             rotas: agendamento, sala, cron, webhooks, API v1 e MCP
src/lib/           regras do sistema (regras/ = funções puras testadas), Supabase, RealtimeKit, R2, IA
supabase/
  migrations/      o banco, aplicado em ordem com "supabase db push"
  opcional/        rotinas pelo Supabase, pra quem usa a Vercel grátis
scripts/           realtimekit-setup.ts (perfis da sala e webhook)
tests/             testes automáticos (npm test)
docs/              guias
```

## Licença

MIT. Veja [LICENSE](LICENSE).

---

Feito pelo Grupo Vórtex · entregue na Plataforma Vórtex IA
