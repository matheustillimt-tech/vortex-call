# Prompt de instalação (Claude Code)

Abra o Claude Code (aba **Code**) numa **pasta vazia** do seu computador e cole o texto abaixo inteiro. O Claude vai
instalar o Vórtex Call com você, passo a passo, esperando você em cada conta que precisar criar.

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
