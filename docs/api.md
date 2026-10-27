# API e MCP do Vórtex Call

Referência curta das rotas REST (`/api/v1/*`) e das ferramentas do servidor MCP (`/api/mcp`). As duas usam a mesma
chave de acesso e, por baixo, as mesmas regras (`src/lib/api/*`): mesmos campos, mesmas mensagens de erro.

Chave criada e revogada na tela **Integrações** (admin): cartão "Chaves de acesso" → "Criar chave" (nome + permissão
`leitura` ou `escrita`). A chave (`vc_...`) só aparece naquele instante: copie na hora. Nos exemplos abaixo, troque
`seu-dominio.com.br` pelo seu endereço e guarde a chave numa variável do terminal antes (`export CHAVE=vc_...`).

## Autenticação

Toda chamada (REST e MCP) manda a chave no cabeçalho:

```
Authorization: Bearer vc_SUA_CHAVE
```

- Chave ausente, mal formada ou revogada → `401`.
- Chave de quem foi desativado ou deixou de ser admin → `401` (a chave para de valer, mesmo sem ser revogada).
- Permissão `leitura` chamando uma rota de escrita → `403`.
- Mais de 120 chamadas por minuto com a mesma chave → `429` (cabeçalho `retry-after`).
- Erro ao conferir a chave no banco → `503`.

Nunca logue a chave nem a mande em nenhum lugar fora desse cabeçalho.

## API REST (`/api/v1`)

Todas as respostas são JSON. Erro de negócio sempre `{ "erro": "..." }` com o status certo (`404`, `409`, `422`,
`502`). Datas de saída são ISO 8601 em UTC; `inicio_texto` e as mensagens já vêm em horário de Brasília.

**Datas de entrada** (`inicio` no corpo; `de`/`ate` na query): três formas, todas aceitas em qualquer campo de
data.

- ISO 8601 com fuso (`2026-11-03T12:00:00Z` ou `2026-11-03T12:00:00-03:00`): usa o fuso informado.
- ISO sem fuso (`2026-11-03T12:00` ou `2026-11-03T12:00:00`): lido como horário de Brasília.
- Só a data (`2026-11-03`), também Brasília: em `de` vale a meia-noite daquele dia; em `ate`, o último milissegundo
  do dia (23:59:59.999), pra cobrir o dia todo sem bater na meia-noite do dia seguinte.

Data mal formada ou impossível (`2026-02-30`, `25:00`) → `422`.

### `GET /api/v1/agendas`

Leitura. Todas as agendas (ativas e desativadas).

```bash
curl https://seu-dominio.com.br/api/v1/agendas \
  -H "Authorization: Bearer $CHAVE"
```

```json
[{ "id": "...", "nome": "Diagnóstico", "slug": "diagnostico", "ativa": true, "duracao_min": 30, "vagas_padrao": 30, "responsavel": "Hugo Prado", "link_agendar": "https://seu-dominio.com.br/agendar/diagnostico" }]
```

`responsavel`: nome do vendedor responsável pela agenda (`null` = sem responsável).

### `GET /api/v1/sessoes`

Leitura. Sessões coletivas por início, até 200. Padrão: de agora até 14 dias.

Query opcional: `agenda` (slug, `404` se não existir), `de`, `ate` (ISO 8601 ou `AAAA-MM-DD`; "de" precisa vir
antes de "ate").

```bash
curl "https://seu-dominio.com.br/api/v1/sessoes?agenda=diagnostico&de=2026-11-01&ate=2026-11-15" \
  -H "Authorization: Bearer $CHAVE"
```

```json
[{ "id": "...", "agenda": "diagnostico", "titulo": null, "inicio": "2026-11-03T15:00:00.000Z", "inicio_texto": "terça-feira, 03/11 às 12:00", "vagas": 30, "inscritos": 4, "status": "agendada", "anfitriao": null }]
```

`inscritos` conta só as inscrições que não foram canceladas. `anfitriao`: nome de quem entrou primeiro como
anfitrião (`null` = ninguém ainda). `status`: `agendada`, `ao_vivo`, `encerrada`,
`cancelada`.

### `POST /api/v1/sessoes`

Escrita. Cria uma sessão numa agenda ativa.

Corpo: `{ "agenda": "slug", "inicio": "2026-11-03T12:00:00-03:00", "vagas": 20, "titulo": "Turma de novembro" }`.
Só `agenda` e `inicio` são obrigatórios; `vagas` sem informar usa o padrão da agenda; `titulo` até 200 caracteres.

```bash
curl -X POST https://seu-dominio.com.br/api/v1/sessoes \
  -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{ "agenda": "diagnostico", "inicio": "2026-11-03T12:00:00-03:00" }'
```

`201` com a sessão criada (mesmo formato de `GET`). `422` com agenda inexistente/desativada, início no passado ou
vagas fora de 1 a 500.

### `POST /api/v1/sessoes/{id}/cancelar`

Escrita. Cancela a sessão (só se estiver `agendada`) e as inscrições `agendado` dela, liberando quem se inscreveu
para agendar de novo.

```bash
curl -X POST https://seu-dominio.com.br/api/v1/sessoes/ID/cancelar \
  -H "Authorization: Bearer $CHAVE"
```

`200` com a sessão cancelada. `404` sessão inexistente; `409` já não estava `agendada`.

### `GET /api/v1/sessoes/{id}/inscritos`

Leitura. Inscritos da sessão (todos os status), com WhatsApp, e-mail, minutos na sala, entradas/saídas e os
avisos mandados ao CRM. Dados pessoais: só por chave válida, nunca em log.

```bash
curl https://seu-dominio.com.br/api/v1/sessoes/ID/inscritos \
  -H "Authorization: Bearer $CHAVE"
```

```json
[{ "id": "...", "nome": "Ana", "whatsapp": "+551139999999", "email": null, "status": "compareceu", "minutos_na_sala": 42, "presencas": [{ "entrou_em": "...", "saiu_em": "..." }], "avisos": [{ "evento": "lembrete_24h", "status": "enviado" }] }]
```

`status` da inscrição: `agendado`, `compareceu`, `faltou`, `cancelado`. `avisos.evento` é um dos 6 eventos
mandados ao CRM: `agendou`, `lembrete_24h`, `lembrete_1h`, `comecou`, `faltou`, `compareceu`.
`avisos.status`: `pendente` (ainda não chegou a hora), `enviado`, `falhou` (esgotou as tentativas) ou
`sem_destino` (a agenda não tem URL de CRM configurada).

`404` sessão inexistente.

### `GET /api/v1/sessoes/{id}/resumo`

Resumo do que foi alinhado na call, numa sessão de agenda com "Transcrever e resumir a call". Com `?transcricao=1`,
traz também a transcrição em texto ("[15:02] Ana: …"), cortada em 50 mil caracteres.

```bash
curl "https://seu-dominio.com.br/api/v1/sessoes/ID/resumo?transcricao=1" \
  -H "Authorization: Bearer $CHAVE"
```

```json
{ "sessao": { "id": "...", "titulo": null, "inicio": "...", "inicio_texto": "26/10/2026 15:00" },
  "estado": "pronto",
  "resumo": { "texto": "RESUMO DA CALL (26/10 15:00, 42 min, conduzida por Gabriel)\nNegócio: …", "dados": { "negocio": "…", "dor": "…", "quer": "…", "combinado": [], "escopo": [], "orcamento_prazo": "", "objecoes": [], "proximo_passo": "…", "temperatura": "quente", "temperatura_motivo": "…" }, "origem": "cloudflare", "gerado_em": "..." },
  "transcricao": "[15:02] Ana: …", "transcricao_cortada": false }
```

Os valores de `estado` são:
- `sem_transcricao`: a sessão não foi transcrita.
- `aguardando`: a call ainda não acabou.
- `pendente`: o resumo está na fila.
- `pronto`.
- `sem_fala`: a call teve menos de 3 minutos de conversa.
- `falhou`: a IA falhou 3 vezes.

`origem` diz de onde veio o texto: `cloudflare` é a transcrição completa feita depois da call, e `ao_vivo` é a do ao
vivo, usada quando a completa não chegou.

### `POST /api/v1/reunioes`

Escrita. Cria uma reunião instantânea em nome de quem criou a chave e devolve o link.

Corpo opcional: `{ "titulo": "Alinhamento" }` (até 200 caracteres).

```bash
curl -X POST https://seu-dominio.com.br/api/v1/reunioes \
  -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{ "titulo": "Alinhamento" }'
```

`201` com `{ "codigo": "...", "link": "https://seu-dominio.com.br/r/..." }`. `422` se quem criou a chave foi
apagado do time (crie uma chave nova em Integrações); `502` se o RealtimeKit falhar.

### `GET /api/v1/gravacoes`

Leitura. Gravações de sessões e reuniões, mais nova primeiro, até 200. Padrão: últimos 7 dias. Query opcional: `de`,
`ate`.

```bash
curl https://seu-dominio.com.br/api/v1/gravacoes \
  -H "Authorization: Bearer $CHAVE"
```

```json
[{ "id": "...", "origem": "sessao", "titulo": "Diagnóstico", "iniciada_em": "2026-11-03T15:00:00.000Z", "duracao_s": 1820, "status": "UPLOADED", "armazenamento": "r2", "disponivel_ate": null, "expirada": false }]
```

`armazenamento`: `"r2"` (arquivo no R2 da empresa, não expira, `disponivel_ate` vem `null`) ou `"cloudflare"`
(storage do RealtimeKit: `disponivel_ate` = início + 7 dias, depois `expirada: true`).

`origem` é `"sessao"` ou `"reuniao"`. `status` vem do RealtimeKit: `RECORDING`, `UPLOADING`, `UPLOADED`, `ERRORED`.
Nunca devolve o link de download salvo (pode ter vencido): peça com a rota abaixo.

### `GET /api/v1/gravacoes/{id}/link`

Leitura. Gera o link na hora: no R2, link assinado que vale 1 hora; na Cloudflare, pedido ao RealtimeKit. Os dois
vencem: peça de novo quando precisar.

```bash
curl https://seu-dominio.com.br/api/v1/gravacoes/ID/link \
  -H "Authorization: Bearer $CHAVE"
```

```json
{ "url": "https://.../arquivo.mp4", "expira": "2026-11-03T16:00:00.000Z" }
```

`404` gravação inexistente, sem arquivo ainda ou já fora dos 7 dias de retenção; `502` RealtimeKit fora do ar.

No painel, a tela **Gravações** usa a mesma regra por `GET /api/gravacoes/{id}/link` (rota separada, autenticada
pelo login de quem está na equipe, não por chave `vc_`): "Assistir" abre numa aba nova, "Baixar" é o mesmo link com
`?baixar=1`. Gravação expirada mostra uma página avisando que a Cloudflare guarda só 7 dias.

## MCP (`/api/mcp`)

Servidor MCP (Streamable HTTP, JSON-RPC 2.0, sem estado): um `POST` por chamada, sem SSE e sem sessão (`GET` e
`DELETE` devolvem `405`). Pra conectar no Claude Code, use o comando pronto do cartão "MCP para o Claude" em
**Integrações**:

```bash
claude mcp add --transport http vortex-call https://seu-dominio.com.br/api/mcp --header "Authorization: Bearer SUA_CHAVE"
```

Revogar a chave corta o acesso na hora (API e MCP); ela também para de valer sozinha se quem criou for desativado
ou deixar de ser admin.

Cada ferramenta reaproveita a mesma função da API REST acima, então os campos e as mensagens de erro são os
mesmos. As de escrita (`criar_sessao`, `cancelar_sessao`, `criar_reuniao`) exigem chave com permissão `escrita`,
igual à API REST, e pedem confirmação antes de mudar algo (o Claude mostra o que vai acontecer e só segue depois
do OK de quem está usando).

| Ferramenta | O que faz |
|---|---|
| `listar_agendas` | Lista as agendas, com o responsável (vendedor) e o link público de agendamento. |
| `listar_sessoes` | Sessões por início (padrão: de agora até 14 dias), com vagas, inscritos e anfitrião. |
| `criar_sessao` | Cria uma sessão numa agenda ativa. |
| `cancelar_sessao` | Cancela uma sessão agendada e as inscrições dela (pede confirmação com o total de inscritos antes de cancelar). |
| `ver_inscritos` | Inscritos de uma sessão: WhatsApp, e-mail, minutos na sala, presenças e avisos ao CRM. |
| `ver_ficha` | Ficha de um inscrito: respostas do formulário, origem, UTMs, resumo da IA, observações e o que foi alinhado na última call. |
| `ver_resumo_call` | Resumo do que foi alinhado numa call transcrita, pela `sessao` ou pelo `whatsapp` do lead (a última call que ele compareceu). Com `transcricao: true`, traz a transcrição junto. É a base pra montar a proposta. |
| `listar_gravacoes` | Gravações de sessões e reuniões (padrão: últimos 7 dias). |
| `link_gravacao` | Link de download de uma gravação, pedido na hora. |
| `criar_reuniao` | Cria uma reunião instantânea em nome de quem criou a chave e devolve o link. |

Dados pessoais (WhatsApp, e-mail, respostas de formulário) só saem por chave válida e nunca aparecem no log do
servidor.
