# Avisos pro seu CRM: agendamentos, lembretes e presença

Toda vez que algo acontece numa call (alguém agendou, está perto da hora, a call começou, a pessoa veio ou faltou),
o Vórtex Call pode avisar o seu CRM, que então manda a mensagem certa no WhatsApp. O aviso é um **webhook**: o Vórtex
Call faz um `POST` com um JSON para um endereço (URL) que o seu CRM te dá.

Funciona com qualquer CRM ou ferramenta de automação que tenha um gatilho do tipo **"Webhook recebido"** (também
chamado de "Webhook de entrada", "Catch hook" ou parecido), por exemplo CRMs com automação de WhatsApp, n8n, Make ou
Zapier. Os nomes dos botões abaixo são genéricos: procure o equivalente na sua ferramenta.

São 8 avisos possíveis, um por evento:

| Aviso | Quando acontece | Manda mensagem pro lead? |
|---|---|---|
| Agendou | A pessoa marcou (ou remarcou) uma call | Sim |
| Lembrete 1 dia antes | Faltam entre 24 h e 1 h para a call | Sim |
| Lembrete 1 hora antes | Falta menos de 1 h para a call | Sim |
| Começou | Chegou o horário marcado da call (sai pra quem ainda não entrou na sala) | Sim |
| Compareceu | A sessão terminou e a pessoa entrou na sala | Não (`mensagem` vazia) |
| Faltou | A sessão terminou e a pessoa não entrou na sala | Sim |
| Resumo da call | A IA terminou o resumo do que foi alinhado (só em agenda com transcrição ligada) | Não |
| Comprou | Chegou uma venda aprovada de alguém que veio numa call (ver `docs/vendas-webhook.md`) | Não |

"Compareceu" e "Faltou" saem logo que o anfitrião encerra a sessão. Se ele não encerrar, saem só 2 h depois do
horário de fim (até lá a sala ainda aceita gente). Sessão que o anfitrião nunca abriu não gera nenhum dos dois.

Cada aviso é configurado **separado**, porque cada um pode disparar uma automação diferente (e você pode nem usar
todos: um aviso sem URL cadastrada simplesmente não é enviado).

**Atenção:** o aviso que aconteceu enquanto não havia URL cadastrada **não é enviado depois**. Se você cadastrar a
URL do "Agendou" hoje, só quem agendar a partir de agora dispara; quem agendou antes fica sem essa mensagem. Por isso,
configure as automações antes de divulgar o link de agendamento.

## Passo 1: criar uma automação no CRM pra cada aviso

No seu CRM, crie uma automação nova (por exemplo "Call: Lembrete 1 dia antes") com o gatilho **"Webhook recebido"**.
Repita pra cada aviso que você quiser usar. Não precisa criar todos de uma vez: comece pelos que mais importam
(geralmente "Lembrete 1 hora antes" e "Faltou").

## Passo 2: copiar a URL do webhook

Dentro da automação, o gatilho mostra a URL que recebe o webhook (um endereço `https://...`). Copie essa URL.

No painel do Vórtex Call, abra a agenda, vá no cartão **"Avisos pro CRM (webhooks)"** e cole a URL no campo do aviso
certo (por exemplo, "Lembrete 1 hora antes"). Salve a agenda. Repita pra cada aviso.

## Passo 3: segredo (recomendado)

Pra garantir que só o seu Vórtex Call consegue disparar essas automações (e não qualquer um que descubra a URL),
cadastre um segredo, que é uma senha longa combinada entre os dois lados:

1. Gere um texto aleatório longo (o seu CRM pode ter um botão pra isso; se não tiver, use um gerador de senhas).
2. No CRM, configure a automação pra só aceitar chamadas com o cabeçalho `X-Webhook-Secret` igual a esse valor.
3. No Vórtex Call, cole o mesmo valor no campo **"Segredo (opcional)"** do cartão da agenda e salve.

Use o **mesmo segredo para todos os avisos daquela agenda**: o Vórtex Call manda um só por agenda, em toda chamada:

- `X-Webhook-Secret`: o segredo em texto (pra ferramentas que só comparam o valor);
- `X-Vortex-Call-Assinatura`: `sha256=` + HMAC-SHA256 do corpo com o segredo (pra quem quiser conferir a assinatura).

Ao editar a agenda depois, deixe o campo de segredo **vazio** pra manter o que já está salvo (ele não aparece de
volta na tela por segurança). Pra remover o segredo, marque **"Remover segredo"**.

## Passo 4: id do evento (evita mensagem repetida)

Todo aviso traz o campo `id_evento`, único por evento e pessoa (ex.: `lembrete_1h:{inscrição}:{sessão}`). Se o seu
CRM tiver uma opção de "ignorar duplicados" ou "campo de id", aponte pra `id_evento`. Assim, se o Vórtex Call mandar o
mesmo aviso duas vezes (numa falha de rede, por exemplo), o CRM não manda a mensagem de novo.

## Passo 5: dados do contato

Mapeie, na automação, os campos do aviso pro contato do CRM:

| Caminho no aviso | Para |
|---|---|
| `lead.nome` | Nome do contato |
| `lead.telefone` | Telefone (só números, com 55 e DDD) |
| `lead.whatsapp` | O mesmo telefone no formato `+55...` |
| `lead.email` | E-mail |

Todo aviso também traz o objeto `campos`, com textos prontos pra guardar no contato (crie campos personalizados com
esses nomes no seu CRM, se quiser ver a call na ficha do contato):

| Caminho no aviso | O que é | Exemplo |
|---|---|---|
| `campos.call_agenda` | Como a call é chamada pro lead: `apresentação` (agenda com "apresentação" no nome) ou `diagnóstico` (todas as outras); nunca o nome interno da agenda | `diagnóstico` |
| `campos.call_horario` | Data e hora da call em Brasília | `quarta-feira, 28/10 às 09:00` |
| `campos.call_link` | Link pessoal pra entrar na sala | `https://seu-dominio.com.br/c/abcdefghjk` |
| `campos.call_reagendar` | Link pra escolher outro horário | `https://seu-dominio.com.br/agendar/diagnostico` |
| `campos.call_status` | Situação: `agendado`, `lembrete`, `começou`, `compareceu`, `faltou` ou `comprou` | `lembrete` |

## Passo 6: texto da mensagem

Todo aviso já chega com a mensagem de WhatsApp **pronta**, no campo `mensagem`. Na ação de enviar mensagem da sua
automação, use só esse campo (na maioria das ferramentas, algo como `{{evento.mensagem}}` ou `{{body.mensagem}}`).

Como ela é feita:

- **Texto fixo**: todo lead recebe o mesmo texto de cada aviso, só trocando o primeiro nome, a data e hora e o link.
  Os textos estão abaixo e moram em `src/lib/regras/mensagem.ts` (função `mensagemPadrao`): mude lá se quiser outro
  tom.
- **Links:** o link da sala no "Agendou", nos lembretes e no "Começou"; o link de reagendar **só** no "Faltou".
- **Compareceu, Resumo e Comprou** vêm com `mensagem` vazia (`""`): servem pra acompanhar, não pra mandar texto. Se
  quiser mandar algo neles, escreva o texto na própria automação.
- **Pro lead, a call se chama sempre "diagnóstico" ou "apresentação"**, nunca "call de vendas" nem o nome interno
  da agenda. Agenda com "apresentação" no nome (ex.: "Consultoria: apresentação") vira "sua apresentação"; todas as
  outras viram "seu diagnóstico".
- Se o envio falhar e o Vórtex Call tentar de novo, a mensagem é **a mesma** da primeira tentativa.

Se preferir escrever o seu próprio texto, as variáveis do aviso continuam todas lá:

- `lead.primeiro_nome`: só o primeiro nome da pessoa
- `sessao.inicio_texto`: data e hora da call já formatada em Brasília (ex.: "quarta-feira, 28/10 às 09:00")
- `link`: o link pessoal da pessoa pra entrar na sala
- `link_reagendar`: o link pra escolher outro horário

Texto fixo de cada aviso (com "diagnóstico"; numa agenda de apresentação fica "Sua apresentação ficou marcada",
"sua apresentação é", "pra sua apresentação" e "Sua apresentação está começando"):

**Agendou**
> Prontinho, {primeiro nome}! Seu diagnóstico ficou marcado pra {data e hora}.
>
> Link pra entrar: {link}

**Lembrete 1 dia antes**
> Oi, {primeiro nome}! Passando pra lembrar: seu diagnóstico é {data e hora}. Guarda o link pra entrar: {link}

**Lembrete 1 hora antes**
> {primeiro nome}, falta menos de 1 hora pro seu diagnóstico! Entra pelo link na hora certa: {link}

**Começou**
> Seu diagnóstico está começando agora, {primeiro nome}! Entra pelo link: {link}

**Faltou**
> {primeiro nome}, vi que não deu pra vir hoje. Sem problema! Escolhe outro horário aqui: {link de reagendar}

Exemplo do que chega no "Lembrete 1 hora antes":

```json
{
  "evento": "lembrete_1h",
  "id_evento": "lembrete_1h:INSCRICAO:SESSAO",
  "enviado_em": "2026-10-28T11:05:00.000Z",
  "agenda": { "slug": "diagnostico", "nome": "Diagnóstico" },
  "sessao": { "id": "SESSAO", "titulo": "Diagnóstico", "inicio": "2026-10-28T12:00:00.000Z", "inicio_texto": "quarta-feira, 28/10 às 09:00" },
  "lead": { "nome": "Maria Souza", "primeiro_nome": "Maria", "whatsapp": "+5511XXXXXXXXX", "telefone": "5511XXXXXXXXX", "email": "maria@exemplo.com" },
  "link": "https://seu-dominio.com.br/c/abcdefghjk",
  "link_reagendar": "https://seu-dominio.com.br/agendar/diagnostico",
  "campos": {
    "call_agenda": "diagnóstico",
    "call_horario": "quarta-feira, 28/10 às 09:00",
    "call_link": "https://seu-dominio.com.br/c/abcdefghjk",
    "call_reagendar": "https://seu-dominio.com.br/agendar/diagnostico",
    "call_status": "lembrete"
  },
  "mensagem": "Maria, falta menos de 1 hora pro seu diagnóstico! Entra pelo link na hora certa: https://seu-dominio.com.br/c/abcdefghjk"
}
```

## Passo 7: testar antes de usar de verdade

No cartão "Avisos pro CRM (webhooks)" da agenda, ao lado de cada URL já salva aparece o botão **"Enviar teste"**. Ele
manda na hora um aviso de exemplo (com um lead fictício, "Lead de Teste", já com `mensagem` e `campos`) pra URL
cadastrada e mostra se o CRM respondeu certo (HTTP 200) ou deu erro. Use sempre depois de configurar uma automação
nova, antes de confiar nela com leads de verdade.

Se algum aviso de verdade falhar, ele aparece na página **"Avisos"** da agenda (link "Ver avisos enviados" no mesmo
cartão), com o motivo e um botão **"Tentar de novo"**. A entrega roda de 1 em 1 minuto, com até 4 tentativas (1, 5 e
15 minutos depois da falha).

## Disparo pela API oficial do WhatsApp (opcional)

Se você manda as mensagens pro lead por uma ferramenta de disparo ligada à **API oficial do WhatsApp** (separada do
CRM), cole a URL de webhook dela no campo **"Disparo pela API oficial (opcional)"**. Ela recebe só os avisos que viram
mensagem (Agendou, lembretes, Começou e Faltou), com o mesmo corpo e o mesmo segredo; o CRM continua recebendo tudo
pelas URLs de cima. Cada destino tem a sua fila: se um cair, o outro segue.

## Um lembrete importante sobre o WhatsApp

Se a sua conexão usa a **API oficial do WhatsApp**, ela só permite responder livremente dentro de uma janela de
**24 horas** depois da última mensagem que a pessoa mandou. Fora desse prazo, só sai mensagem por **modelo aprovado**
(template). Isso vale principalmente pro "Lembrete 1 dia antes" e pro "Faltou", que costumam cair fora da janela:
confirme se os modelos necessários estão aprovados antes de ligar essas automações pra valer.

## Resumo da call (evento `resumo`)

Só sai nas agendas com **"Transcrever e resumir a call"** ligado (e com a IA configurada, ver `INSTALACAO.md`).
Depois da call, a IA lê a transcrição e escreve o que foi alinhado. O aviso vai pra cada inscrição que
**compareceu** (`id_evento` = `resumo:{inscrição}:{sessão}`) e **não manda mensagem pro lead**.

| Campo | O que é |
|---|---|
| `resumo_texto` | O resumo em formato fixo, com até 2.500 caracteres: cabeçalho, negócio, dor, o que a pessoa quer, o que foi combinado, escopo, orçamento e prazo, objeções, próximo passo e temperatura. Bloco vazio vira "não falaram". Se a IA falhar 3 vezes, vai o começo da transcrição com o aviso "O resumo automático falhou". |
| `resumo` | O mesmo resumo em JSON: `negocio`, `dor`, `quer`, `combinado[]`, `escopo[]`, `orcamento_prazo`, `objecoes[]`, `proximo_passo`, `temperatura` e `temperatura_motivo`. Vem `null` quando a IA falhou. |

Sugestão de automação: gatilho "Webhook recebido" (mesmo segredo e mesmo `id_evento`) e uma ação que **acrescenta**
`resumo_texto` como anotação no negócio/oportunidade do contato, sem apagar as anotações anteriores. Nenhuma mensagem.

O "Enviar teste" manda um resumo de exemplo, marcado como teste.

## Comprou (evento `comprou`)

Sai quando chega pelo webhook de vendas (`docs/vendas-webhook.md`) uma compra aprovada de alguém que **veio** numa
call (mesmo WhatsApp ou e-mail, sessão até 7 dias antes da compra). Se a compra chega antes da presença ser avaliada,
sai junto com o "compareceu". Um por inscrição e sessão (`comprou:{inscrição}:{sessão}`): a segunda compra da mesma
pessoa não repete. **Não manda mensagem pro lead**; `campos.call_status` = `comprou`.

| Campo | O que vem |
|---|---|
| `venda.valor` | Valor pago em reais com ponto, ex.: `3490.12` |
| `venda.valor_texto` | O mesmo formatado, ex.: `R$ 3.490,12` |
| `venda.produto` | Nome do produto |
| `venda.pedido` | Id do pedido na plataforma de pagamento |
| `venda.comprada_em_texto` | Data e hora da compra (Brasília) |

Sugestão de automação: mover o negócio do contato pra etapa "Comprou" e registrar o valor (`venda.valor`).

O "Enviar teste" manda uma venda de exemplo de R$ 1.997,00.

## Avisos pra equipe

Além dos avisos pro lead (configurados por agenda), o Vórtex Call avisa no WhatsApp o **vendedor responsável pela
agenda** (campo "Responsável (vendedor)" no editor da agenda). Esses avisos usam **uma URL só pra equipe toda**:

1. No CRM, crie **uma** automação com o gatilho "Webhook recebido" (por exemplo "Call: avisos pra equipe").
2. Em **Configurações** do Vórtex Call, cartão **"Avisos pra equipe (webhook)"**, cole a URL e, se quiser, o
   segredo (vai nos mesmos cabeçalhos dos avisos do lead). Salve.
3. Em **Equipe**, preencha o **WhatsApp** de cada vendedor (lápis na linha da pessoa).
4. Use o botão **"Enviar teste"** do cartão: ele manda um "novo agendamento" de exemplo em que o vendedor é você
   (com o seu WhatsApp da Equipe, se tiver).

Só sai aviso quando a agenda tem responsável **ativo com WhatsApp** e a URL está cadastrada (conferido de novo na hora
do envio). Cada (re)agendamento gera um aviso novo. São 3 avisos, todos na mesma automação (o texto vem pronto em
`mensagem`):

| `evento` | Quando |
|---|---|
| `vendedor_novo_agendamento` | Um lead agendou (ou reagendou pra outro horário) numa agenda dele |
| `vendedor_sessao_em_breve` | 10 minutos antes de uma sessão dele com pelo menos 1 inscrito (uma vez por sessão) |
| `vendedor_resumo_diario` | Todo dia às 08:00 (Brasília), com as calls do dia que ainda vão acontecer e já têm inscrito; sem nenhuma, não sai |

**Mapeamento:** `vendedor.telefone` → telefone, `vendedor.nome` → nome. **Mensagem:** o campo `mensagem`. **Id do
evento:** `id_evento`. A entrega segue a mesma fila e as mesmas tentativas dos avisos do lead.

Corpo enviado (exemplo do novo agendamento):

```json
{
  "evento": "vendedor_novo_agendamento",
  "id_evento": "vendedor_novo_agendamento:{inscricao}:{sessao}:{agendado_em em ms}",
  "enviado_em": "2026-10-23T14:12:00.000Z",
  "vendedor": { "nome": "Bruna Lima", "primeiro_nome": "Bruna", "telefone": "5511XXXXXXXXX", "whatsapp": "+5511XXXXXXXXX" },
  "mensagem": "Bruna, novo agendamento na sua agenda \"Diagnóstico (grupo)\".\n\nLead: Maria Silva\nWhatsApp: +5511XXXXXXXXX\nQuando: terça-feira, 27/10 às 19:00\n\nSobre o lead:\nDona de clínica, quer automatizar o agendamento.\n\nEntrar na sala como anfitrião:\nhttps://seu-dominio.com.br/equipe/sala/{sessao}?modo=anfitriao\n\nVer a sessão no painel:\nhttps://seu-dominio.com.br/sessoes/{sessao}",
  "dados": {
    "reagendou": false,
    "agenda": { "id": "…", "nome": "Diagnóstico (grupo)", "slug": "diagnostico-grupo" },
    "sessao": { "id": "…", "titulo": "Diagnóstico (grupo)", "inicio": "2026-10-27T22:00:00.000Z", "inicio_texto": "terça-feira, 27/10 às 19:00" },
    "lead": { "nome": "Maria Silva", "whatsapp": "+5511XXXXXXXXX", "email": "maria@exemplo.com", "resumo": "Dona de clínica, quer automatizar o agendamento." },
    "link_anfitriao": "https://seu-dominio.com.br/equipe/sala/{sessao}?modo=anfitriao",
    "link_sessao": "https://seu-dominio.com.br/sessoes/{sessao}"
  }
}
```

- `vendedor_sessao_em_breve`: `mensagem` = "Bruna, sua call das 19:00 começa em 10 min, 5 inscritos." (os minutos
  são contados na hora do envio; se a call já começou, o aviso não sai) + nome da sessão + link de anfitrião; `dados`
  traz `sessao`, `hora`, `minutos`, `inscritos`, `link_anfitriao`, `link_sessao`.
- `vendedor_resumo_diario`: `mensagem` = "Bom dia, Bruna! Suas calls de hoje (terça-feira, 27/10):" + uma linha por
  call ("19:00 · Nome · 5 inscritos" e o link de anfitrião embaixo) + link do painel; `dados` traz `dia`,
  `dia_texto`, `total_sessoes`, `total_inscritos` e `sessoes` (hora, inscritos e links de cada uma).
- "Sobre o lead" usa o resumo da IA da ficha (se já existir) ou até 3 respostas do formulário; sem nada, o bloco não
  aparece. Texto fixo, sem IA e sem markdown, com cada link sozinho na linha.
