# Cloudflare RealtimeKit — Referência Técnica

> Levantamento feito em 22/10/2026 na documentação oficial da Cloudflare (`developers.cloudflare.com/realtime/realtimekit/` e `developers.cloudflare.com/api/resources/realtime_kit/`). Cada afirmação cita a URL de origem. RealtimeKit é o produto antigo "Dyte" incorporado à Cloudflare.

## 0. Conceitos-base

- **App**: o container que guarda Presets e meetings. Criado via dashboard ou `POST /accounts/{account_id}/realtime/kit/apps` com `{"name": "..."}`.
  Fonte: https://developers.cloudflare.com/realtime/realtimekit/quickstart/
- **Meeting**: sala virtual reutilizável, sem hora de início/fim — "a Meeting itself doesn't 'start' or 'end'; it just exists". Pode ser criada com antecedência ou just-in-time.
  Fonte: https://developers.cloudflare.com/realtime/realtimekit/concepts/meeting/
- **Session**: instância ao vivo de uma Meeting. Começa quando o primeiro participante entra e termina pouco depois do último sair. O billing por participante-minuto é cobrado só durante a Session ativa, não enquanto a Meeting fica "parada".
  Fonte: https://developers.cloudflare.com/realtime/realtimekit/concepts/meeting/
- **Participant**: um usuário autorizado a entrar numa Meeting específica, criado via Add Participant API, recebendo `id` + `token` (JWT, válido 100 dias, sem data de início customizável).
  Fonte: https://developers.cloudflare.com/realtime/realtimekit/concepts/participant/
- **Preset**: configuração reutilizável que define tipo de reunião (Video/Audio/Webinar/Livestream Beta), permissões e aparência (tema/cores) de um participante. Presets são aplicados a participantes, não a meetings — dois participantes na mesma meeting podem ter presets diferentes.
  Fonte: https://developers.cloudflare.com/realtime/realtimekit/concepts/preset/

---

## 1. REST API base — Meetings e Participantes

Base: `https://api.cloudflare.com/client/v4/accounts/{account_id}/realtime/kit/{app_id}/...`
Header obrigatório: `Authorization: Bearer <CLOUDFLARE_API_TOKEN>` com permissão `Realtime` ou `Realtime Admin`.
Fonte: https://developers.cloudflare.com/api/resources/realtime_kit/subresources/meetings/methods/create/

### Endpoints de Meetings (resource `meetings`)

| Operação | Método + path |
|---|---|
| Listar meetings | `GET /meetings` |
| Criar meeting | `POST /meetings` |
| Obter meeting | `GET /meetings/{meeting_id}` |
| Atualizar meeting (parcial) | `PATCH /meetings/{meeting_id}` |
| Substituir meeting | `PUT /meetings/{meeting_id}` |
| Listar participantes cadastrados | `GET /meetings/{meeting_id}/participants` |
| Adicionar participante | `POST /meetings/{meeting_id}/participants` |
| Obter participante | `GET /meetings/{meeting_id}/participants/{participant_id}` |
| Atualizar participante | `PATCH /meetings/{meeting_id}/participants/{participant_id}` |
| Deletar participante (revoga todos os tokens) | `DELETE /meetings/{meeting_id}/participants/{participant_id}` |
| Refresh de token do participante | `POST /meetings/{meeting_id}/participants/{participant_id}/token` |

Fonte: https://developers.cloudflare.com/api/resources/realtime_kit/subresources/meetings/ e https://developers.cloudflare.com/realtime/realtimekit/concepts/participant/

### Criar meeting

```bash
curl https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/realtime/kit/{APP_ID}/meetings \
  --request POST \
  --header "Authorization: Bearer <CLOUDFLARE_API_TOKEN>" \
  --header "Content-Type: application/json" \
  --data '{"title": "My First Cloudflare RealtimeKit meeting"}'
```

Campos do corpo (`POST /meetings`):

| Campo | Tipo | Descrição |
|---|---|---|
| `title` | string (opcional) | Título da meeting |
| `record_on_start` | boolean (opcional) | Começa a gravar automaticamente quando o primeiro participante entra |
| `live_stream_on_start` | boolean (opcional) | Começa o livestream automaticamente ao iniciar |
| `persist_chat` | boolean (opcional) | "Meeting chat would remain for a week within the meeting space" — mantém o chat por uma semana |
| `session_keep_alive_time_in_secs` | number (opcional) | Quanto tempo a sessão fica viva depois que o último participante sai (60–600s) |
| `transcribe_on_end` | boolean (opcional) | Gera transcrição automaticamente ao encerrar |
| `summarize_on_end` | boolean (opcional) | Gera resumo por IA a partir da transcrição |
| `ai_config` | object (opcional) | Configurações de transcrição/resumo |
| `recording_config` | object (opcional) | Config de áudio/vídeo/storage/streaming da gravação |

Resposta:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601",
    "status": "ACTIVE" | "INACTIVE",
    "title": "string",
    "record_on_start": false,
    "live_stream_on_start": false,
    "persist_chat": false,
    "session_keep_alive_time_in_secs": 60,
    "transcribe_on_end": false,
    "summarize_on_end": false,
    "ai_config": {},
    "recording_config": {}
  }
}
```

Fonte: https://developers.cloudflare.com/api/resources/realtime_kit/subresources/meetings/methods/create/ e https://developers.cloudflare.com/realtime/realtimekit/concepts/meeting/

### Atualizar meeting / status ACTIVE-INACTIVE

Para bloquear novas entradas numa meeting (ex.: depois de uma data limite), primeiro remova a sessão ativa (`active-session/kick-all`, ver seção 3) e depois:

```bash
curl https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/realtime/kit/{APP_ID}/meetings/{MEETING_ID} \
--request PATCH \
--header "Authorization: Bearer <CLOUDFLARE_API_TOKEN>" \
--header "Content-Type: application/json" \
--data '{ "status": "INACTIVE" }'
```

`status` aceita `ACTIVE` ou `INACTIVE`. Com `INACTIVE` ninguém consegue entrar nem iniciar nova sessão.
Fonte: FAQ em https://developers.cloudflare.com/realtime/realtimekit/faq/ (seção "How do I prevent participants from joining a meeting after a specific date or time?")

### Adicionar participante

```bash
curl --location 'https://api.cloudflare.com/client/v4/accounts/<account_id>/realtime/kit/<app_id>/meetings/<meeting_id>/participants' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer <api_token>' \
--data '{
  "name": "Mary Sue",
  "preset_name": "<preset_name>",
  "custom_participant_id": "<uuid_of_the_user_in_your_system>"
}'
```

Campos do corpo:

| Campo | Tipo | Obrigatório |
|---|---|---|
| `preset_name` | string | sim |
| `custom_participant_id` | string | recomendado (identificador estável do seu sistema; **nunca** e-mail/telefone/PII) |
| `name` | string | não |
| `picture` | string (URI) | não |

Resposta:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "token": "<jwt usado pelo client SDK>",
    "created_at": "ISO datetime",
    "updated_at": "ISO datetime",
    "custom_participant_id": "string",
    "preset_name": "string",
    "name": "string",
    "picture": "string"
  }
}
```

Observação: o campo da resposta é `token` (não `authToken`) na API REST; o SDK/exemplos chamam esse mesmo valor de `authToken` ao passá-lo ao client (`RealtimeKitClient.init({ authToken: ... })`).
Fonte: https://developers.cloudflare.com/api/resources/realtime_kit/subresources/meetings/methods/add_participant/ e https://developers.cloudflare.com/realtime/realtimekit/quickstart/

### Refresh de token do participante

`POST /meetings/{meeting_id}/participants/{participant_id}/token` — gera um novo token para o mesmo `participant_id`/preset, sem invalidar tokens anteriores (cada um expira por conta própria, 100 dias após emissão).
Fonte: https://developers.cloudflare.com/realtime/realtimekit/concepts/participant/

### Deletar / "kickar" participante

- **Delete Participant** (`DELETE /meetings/{meeting_id}/participants/{participant_id}`) revoga todos os tokens — o participante não pode mais gerar sessão nova.
- Antes disso, se ele estiver numa sessão ativa, use **Kick Participants** (ver seção 3) para removê-lo da call em tempo real.
Fonte: https://developers.cloudflare.com/realtime/realtimekit/concepts/participant/

### Listar participantes de uma sessão ativa

Não é o mesmo endpoint de "listar participantes cadastrados" (`GET /meetings/{id}/participants`, que lista todos os já adicionados, estejam online ou não). Para ver quem está **ao vivo agora**, use o recurso `active-session` (seção 3): `GET /meetings/{meeting_id}/active-session`.
Fonte: https://developers.cloudflare.com/api/resources/realtime_kit/subresources/active-session/

---

## 2. Presets — permissões, host, guest e participante "hidden"

### Criar/listar/atualizar via API

```bash
curl https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/realtime/kit/$APP_ID/presets \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -d '{"config": {"...": "..."}}'
```

Endpoint: `POST /accounts/{account_id}/realtime/kit/{app_id}/presets` (e os correspondentes GET/list/update no mesmo resource `presets`).
Fonte: https://developers.cloudflare.com/realtime/realtimekit/concepts/preset/ e https://developers.cloudflare.com/api/resources/realtime_kit/subresources/presets/methods/create/

### Estrutura de um Preset (`name`, `config`, `permissions`, `ui`)

**`config`:**
```
config: {
  view_type: "GROUP_CALL" | "WEBINAR" | "AUDIO_ROOM" | "LIVESTREAM"
  max_screenshare_count: number
  max_video_streams: { desktop: number, mobile: number }
  media: {
    video:       { quality: "qvga"|"vga"|"hd"|"fhd"|"uhd", frame_rate: number(<=30), simulcast?: boolean }
    screenshare: { quality: "qvga"|"vga"|"hd"|"fhd"|"uhd", frame_rate: number }
    audio:       { enable_high_bitrate?: boolean, enable_stereo?: boolean }
  }
  livestream_viewer_qualities?: number[]
}
```

**`permissions` — controles de mídia (produção):**
```
media: {
  audio:       { can_produce: "ALLOWED" | "NOT_ALLOWED" | "CAN_REQUEST" }
  video:       { can_produce: "ALLOWED" | "NOT_ALLOWED" | "CAN_REQUEST" }
  screenshare: { can_produce: "ALLOWED" | "NOT_ALLOWED" | "CAN_REQUEST" }
}
```

**`permissions` — host controls (moderação):**
- `can_change_participant_permissions`, `disable_participant_audio`, `disable_participant_video`, `disable_participant_screensharing`, `kick_participant`, `pin_participant`, `can_spotlight` (todos boolean)

**`permissions` — chat:**
```
chat: {
  public:  { can_send: boolean, text: boolean, files: boolean }
  private: { can_send: boolean, can_receive: boolean, text: boolean, files: boolean }
}
```

**Participante oculto / "spy" / gravador:**
- `hidden_participant`: boolean — controla se o participante é visível para os outros.
- `is_recorder`: boolean (opcional) — marca o participante como gravador.
- `recorder_type`: `"RECORDER" | "LIVESTREAMER" | "NONE"`.

Não existe um campo chamado literalmente "spy" — o padrão oficial da Cloudflare para um participante invisível/observador é a combinação `hidden_participant: true` (+ opcionalmente `is_recorder`/`recorder_type` se o objetivo for um bot de gravação/transcrição).
Fonte: https://developers.cloudflare.com/api/resources/realtime_kit/subresources/presets/methods/create/

**Waiting room / stage:**
```
waiting_room_type: "SKIP" | "ON_PRIVILEGED_USER_ENTRY" | "SKIP_ON_ACCEPT"
accept_waiting_requests: boolean   // quem pode aceitar/rejeitar solicitações da waiting room
stage_access: "ALLOWED" | "NOT_ALLOWED" | "CAN_REQUEST"
stage_enabled: boolean
accept_stage_requests: boolean     // quem pode aceitar pedidos de subir ao palco (webinar)
can_accept_production_requests: boolean
```
Comportamentos de waiting room descritos na doc de conceitos (texto, não nomes de campo confirmados 1:1 com o editor visual):
- "Join when accepted by someone" (fica esperando até um host admitir)
- "Join when a privileged user joins" (entra automaticamente quando um host/privilegiado entra)
- "Accept users into waiting room" (host vê lista e admite individualmente/em massa)
Fonte: https://developers.cloudflare.com/realtime/realtimekit/concepts/meeting/#waiting-room e https://developers.cloudflare.com/api/resources/realtime_kit/subresources/presets/methods/create/

**Outras permissões relevantes:**
`can_record`, `can_livestream`, `show_participant_list`, `can_edit_display_name`, `transcription_enabled`, `polls: {can_create, can_view, can_vote}`, `plugins: {can_start, can_close, can_edit_config, config}`, `connected_meetings: {can_alter_connected_meetings, can_switch_connected_meetings, can_switch_to_parent_meeting}`.
Fonte: https://developers.cloudflare.com/api/resources/realtime_kit/subresources/presets/methods/create/

**`ui.design_tokens`:** `border_radius`, `border_width`, `theme` (`darkest`/`dark`/`light`), `spacing_base`, `font_family`, `google_font`, `logo`, `colors.{background,brand,danger,success,text,text_on_brand,video_bg,warning}`.
Fonte: https://developers.cloudflare.com/api/resources/realtime_kit/subresources/presets/methods/create/

### Presets de host/guest/webinar prontos de fábrica

Toda app nova ganha presets default (criados ao criar a app via dashboard), incluindo `webinar_presenter` e `webinar_viewer`:

| Papel | Preset default | Comportamento no palco | Pode aceitar pedidos |
|---|---|---|---|
| Presenter (host-like) | `webinar_presenter` | Entra no palco e publica áudio/vídeo | Sim |
| Viewer (guest) | `webinar_viewer` | Pode pedir para subir ao palco | Não |

Para replicar "host pode compartilhar tela, gravar, mutar outros, kickar, pinar" e "guest com mic/cam permitido mas desligado ao entrar, sem screen share, chat público+privado liberado": combine `media.audio/video.can_produce: "ALLOWED"` (host) vs `"ALLOWED"` também para guest se quiser que ele possa ligar manualmente (o estado inicial ligado/desligado é controlado pelo **client**, via `defaults.audio`/`defaults.video` no SDK, não pelo preset — ver seção 8) e `media.screenshare.can_produce: "NOT_ALLOWED"` para guest.
Fonte: https://developers.cloudflare.com/realtime/realtimekit/webinar/

---

## 3. Duplicidade de join (mesma pessoa em 2 abas)

Resposta oficial da FAQ: **é permitido e não existe kick automático da conexão antiga.**

- "Can the same user join from multiple devices or browser tabs? **Yes.** A single participant can be represented by multiple peers if the user joins the same meeting from different devices or tabs. Each connection becomes a separate peer, but they all map back to the same participant."
- Billing: "**Multiple tabs are billed separately:** If someone joins from multiple browser tabs with the same auth token, RealtimeKit bills each tab separately. The RealtimeKit dashboard displays the aggregated duration for that participant."
- "Can the same participant join multiple sessions of a meeting? **Yes.** As long as the participant exists for that meeting and has a valid authentication token, that participant can join multiple live sessions of the same meeting over time."
Fonte: https://developers.cloudflare.com/realtime/realtimekit/faq/

Não há um setting de preset/meeting para "permitir só 1 conexão por participante" — é responsabilidade da sua aplicação detectar e kickar a conexão antiga.

### Como detectar e kickar via API/SDK

1. No backend, assine o webhook `meeting.participantJoined` (payload traz `customParticipantId` e `peerId`, ver seção 5) e mantenha um mapa `custom_participant_id -> peerId ativo`. Ao receber um novo join com o mesmo `custom_participant_id`, chame a Kick API para o `peerId` anterior.
2. Ou, no client SDK, use `meeting.participants.joined.on("participantJoined", ...)` para detectar entradas e `meeting.participants.getAllJoinedPeers()`/`meeting.participants.joined` para checar duplicatas, acionando o kick via API a partir do backend (o SDK client não tem permissão de kickar sozinho sem permissão de preset `kick_participant`).

Endpoints do resource `active-session`:

| Operação | Método + path |
|---|---|
| Ver detalhes da sessão ativa | `GET /meetings/{meeting_id}/active-session` |
| Kickar participantes específicos | `POST /meetings/{meeting_id}/active-session/kick` |
| Kickar todos | `POST /meetings/{meeting_id}/active-session/kick-all` |
| Criar poll na sessão | `POST /meetings/{meeting_id}/active-session/poll` |

```bash
curl https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/realtime/kit/{APP_ID}/meetings/{MEETING_ID}/active-session/kick \
  --request POST \
  --header "Authorization: Bearer <CLOUDFLARE_API_TOKEN>" \
  --data '{"custom_participant_ids": ["user-123"]}'
```
Corpo aceita `participant_ids` (array) e/ou `custom_participant_ids` (array). Resposta: `data.action`, `data.participants[]` com `id, created_at, updated_at, email, name, picture`.
Fonte: https://developers.cloudflare.com/api/resources/realtime_kit/subresources/active-session/ (kick_participants)

No SDK client, o equivalente a "me kickar/kickar todos localmente com permissão" é `meeting.participants.kickAll()` e, por participante, o método de kick fica em `RTKParticipant` (não detalhado neste levantamento — ver Lacunas).
Fonte: https://developers.cloudflare.com/realtime/realtimekit/humans/core/api-reference/rtkparticipants/

---

## 4. Gravação (Recording)

### Iniciar/parar via SDK (Core SDK, objeto `meeting.recording`, classe `RTKRecording`)

```js
meeting.recording.start();
meeting.recording.stop();   // para todas as gravações em estado RECORDING
meeting.recording.pause();  // pausa as em RECORDING
meeting.recording.resume(); // retoma as em PAUSED
```
Fonte: https://developers.cloudflare.com/realtime/realtimekit/humans/core/api-reference/rtkrecording/

### Iniciar/parar via API

- Start: `POST` no endpoint do resource `recordings` — **Start recording a meeting API** (`.../recordings/methods/start_recordings/`).
- Pausar/retomar/parar: métodos irmãos no mesmo resource `recordings`.
- Consultar uma gravação específica: **Fetch details of a recording** (`.../recordings/methods/get_one_recording/`).
- Consultar gravações ativas: **Fetch active recording** (`.../recordings/methods/get_active_recordings/`).
Fonte: https://developers.cloudflare.com/realtime/realtimekit/recording-guide/

`record_on_start: true` no `POST /meetings` já dispara a gravação assim que o primeiro participante entra (sem precisar chamar a Start Recording API manualmente).
Fonte: https://developers.cloudflare.com/api/resources/realtime_kit/subresources/meetings/methods/create/

### Storage: default (Cloudflare) vs custom (R2/S3/Azure/DigitalOcean/GCS)

Por padrão, as gravações finalizadas ficam no **bucket R2 da própria Cloudflare/RealtimeKit**. É possível fazer upload do resultado para o seu próprio bucket (AWS S3, Azure, DigitalOcean, Google Cloud Storage, ou seu próprio R2) configurando `storage_config` na chamada de Start Recording (tem precedência sobre o que estiver configurado no Dashboard):

```json
{
  "meeting_id": "97440c6a-140b-40a9-9499-b23fd7a3868a",
  "storage_config": {
    "type": "cloudflare",
    "access_key": "your-access-key",
    "secret": "your-secret-key",
    "bucket": "your-bucket-name",
    "path": "/",
    "account_id": "your-account-id"
  }
}
```
Campos comuns: `type`, `access_key`, `secret`, `bucket`, `path` (opcional). Campos extras por provedor: R2 exige `account_id`; S3/DigitalOcean/GCS exigem `region`; Azure usa `secret`/`region` em branco.
Fonte: https://developers.cloudflare.com/realtime/realtimekit/recording-guide/custom-cloud-storage/

### Como o Vórtex Call usa (etapa 7, conferido na doc em 23/10/2026)

- Meetings nascem com `record_on_start: false`. A gravação começa por `POST /recordings` (`meeting_id`,
  `file_name_prefix`, `storage_config` R2 quando `R2_*` está configurado) e para com
  `GET /recordings/active-recording/{meeting_id}` + `PUT /recordings/{recording_id}` `{"action": "stop"}`
  (`action` aceita `stop`, `pause`, `resume`). O id da gravação vem em `data.id`.
- `file_name_prefix` aceita letras, números e `_`; o arquivo fica `{prefixo}_{sala}_{timestamp}` (não dá para trocar o
  nome todo). Cada gravação ganha um prefixo único quando a gente começa a gravar: `s_<uuid da sessão sem hífens>_<ms>`
  / `r_<uuid da reunião>_<ms>`, com `path: "gravacoes"`, salvo em `gravacoes.r2_prefixo`. O webhook `UPLOADED` acha a
  chave no bucket por esse prefixo (`src/lib/r2.ts`); se o arquivo ainda não estiver lá, o link procura de novo.
- A doc não diz se `POST /recordings` aceita meeting sem ninguém dentro nem o status de "nada gravando" no
  `active-recording`: tratamos 404 como "nada a parar" e a gravação automática tenta de novo por ~50 s.

### Download URL e retenção

- A **Fetch details of a recording API** retorna o link de download.
- "The file is kept on RealtimeKit's server for seven days before being deleted" — **retenção padrão de 7 dias** no storage da Cloudflare (se você não mover para storage próprio).
Fonte: https://developers.cloudflare.com/realtime/realtimekit/recording-guide/

### Webhook de status

Evento `recording.statusUpdate`. Status possíveis: `RECORDING`, `UPLOADING`, `UPLOADED`, `ERRORED`. Payload de exemplo:

```json
{
  "event": "recording.statusUpdate",
  "recording": {
    "id": "97cb480d-5840-4528-ace3-919b5e386c68",
    "recordingId": "97cb480d-5840-4528-ace3-919b5e386c68",
    "status": "UPLOADED",
    "downloadUrl": "https://example.com/recording.mp4",
    "audioDownloadUrl": "https://example.com/recording.mp3",
    "downloadUrlExpiry": "2026-06-10T10:30:00.000Z",
    "startedTime": "2026-06-03T10:00:00.000Z",
    "stoppedTime": "2026-06-03T10:30:00.000Z",
    "fileSize": "2044680",
    "outputFileName": "weekly-sync.mp4",
    "meetingId": "50c8940e-1b97-402a-97d6-2708b7feca41",
    "recordingDuration": 1800,
    "organizationId": "c94c437b-592a-4a39-b9e2-47ef1451e43b",
    "roomUUID": "05e57591-d89e-45c9-ae44-08dc1eaad0e0"
  },
  "meeting": { "id": "...", "sessionId": "...", "title": "...", "status": "LIVE", "...": "..." }
}
```
Fonte: https://developers.cloudflare.com/realtime/realtimekit/webhooks/

---

## 5. Webhooks

### Registro

`POST /accounts/{account_id}/realtime/kit/{app_id}/webhooks` (resource `webhooks`, método create).

```bash
curl --request POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/realtime/kit/$APP_ID/webhooks" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "name": "Production webhook",
    "url": "https://example.com/webhook",
    "events": ["meeting.started","meeting.ended","meeting.participantJoined","meeting.participantLeft","recording.statusUpdate"],
    "enabled": true
  }'
```

Listar eventos suportados dinamicamente: `GET /accounts/{account_id}/realtime/kit/{app_id}/webhooks/all`.
Fonte: https://developers.cloudflare.com/realtime/realtimekit/webhooks/

### Eventos disponíveis

| Evento | Disparo |
|---|---|
| `meeting.started` | Primeiro participante entra |
| `meeting.ended` | Reunião encerra (host encerrou ou todos saíram) — payload traz `reason`: `HOST_ENDED_MEETING` ou `ALL_PARTICIPANTS_LEFT` |
| `meeting.participantJoined` | Participante entra — payload: `peerId, userDisplayName, customParticipantId, joinedAt` |
| `meeting.participantLeft` | Participante sai — idem + `leftAt` |
| `meeting.chatSynced` | Export do chat de uma reunião encerrada fica disponível — payload traz `chatDownloadUrl`, `chatDownloadUrlExpiry` |
| `recording.statusUpdate` | Gravação muda de status |
| `livestreaming.statusUpdate` | Livestream muda de status (`LIVE`, `OFFLINE`, `IDLE`) — payload traz `playbackUrl`, `ingestServer`, `streamKey` |
| `meeting.transcript` | Transcrição pronta — `transcriptDownloadUrl` |
| `meeting.summary` | Resumo por IA pronto — `summaryDownloadUrl` |

Fonte: https://developers.cloudflare.com/realtime/realtimekit/webhooks/

### Headers e verificação de assinatura

| Header | Descrição |
|---|---|
| `rtk-signature` | Assinatura RSA-SHA256 em Base64 do corpo bruto da requisição |
| `rtk-uuid` | ID único da entrega (dedupe) |
| `rtk-webhook-id` | ID da config de webhook que disparou |

Chave pública (PEM) para verificar: `GET https://api.realtime.cloudflare.com/.well-known/webhooks.json` → `{"success": true, "data": {"publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"}}`.

Algoritmo: `RSASSA-PKCS1-v1_5` com hash `SHA-256`, verificado sobre o **corpo bruto** (não reserializar JSON). Exemplo em Worker (TypeScript):

```ts
async function verifySignature(publicKeyPem: string, signature: string, body: ArrayBuffer): Promise<boolean> {
  const publicKey = await crypto.subtle.importKey(
    "spki",
    Uint8Array.from(atob(publicKeyPem), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["verify"],
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", publicKey,
    Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)),
    body,
  );
}
```

Retry: qualquer `2xx` é sucesso. `5xx` ou erro de rede → reenvia. Não-`2xx` abaixo de `500` → marca como falha e **não** reenvia. Falhas repetidas podem reduzir a frequência de tentativas.
Fonte: https://developers.cloudflare.com/realtime/realtimekit/webhooks/

---

## 6. Chat

- Objeto: `meeting.chat` (Core SDK), métodos de envio: `sendTextMessage(message)`, `sendImageMessage`, `sendFileMessage` (nomes inferidos pelo padrão dos rate limits — ver seção 10), e mensagens customizadas.
- Tipos de mensagem (Web/React): `TextMessage`, `ImageMessage`, `FileMessage`, `CustomMessage` (combina texto/HTML/arquivos/imagens/vídeos). Campo comum `targetUserIds?: string[]` presente quando a mensagem é **privada** (1:1 ou a um subconjunto) e campo `pinned?: boolean` para mensagens fixadas.
- Fetch de histórico: `meeting.chat.fetchPublicMessages()`, `meeting.chat.fetchPrivateMessages()`, `meeting.chat.fetchPinnedMessages()` (paginados, use `timeMs` como cursor). `meeting.chat.messages` está **deprecated** (só guarda as últimas 1000 mensagens antes de você entrar + as recebidas depois).
- Evento em tempo real: `chatUpdate`.
Fonte: https://developers.cloudflare.com/realtime/realtimekit/humans/core/chat/

- Permissões de chat no preset (seção 2): `chat.public.{can_send, text, files}` e `chat.private.{can_send, can_receive, text, files}` — ou seja, mensagem privada e envio de arquivo/imagem no chat são controlados por preset.
Fonte: https://developers.cloudflare.com/api/resources/realtime_kit/subresources/presets/methods/create/

- **Persistência**: `persist_chat: true` no `POST /meetings` mantém o chat da meeting por uma semana dentro do "meeting space".
Fonte: https://developers.cloudflare.com/api/resources/realtime_kit/subresources/meetings/methods/create/

- **Buscar chat após a reunião**: via webhook `meeting.chatSynced`, cujo payload traz `chatDownloadUrl` + `chatDownloadUrlExpiry` (não há, nesta pesquisa, confirmação de um endpoint REST dedicado tipo "GET chat export" fora do webhook — ver Lacunas).
Fonte: https://developers.cloudflare.com/realtime/realtimekit/webhooks/

---

## 7. Virtual background / blur (Web SDK)

Pacote: **`@cloudflare/realtimekit-virtual-background`**.

```bash
npm i @cloudflare/realtimekit-virtual-background
```

```js
import RealtimeKitVideoBackgroundTransformer from "@cloudflare/realtimekit-virtual-background";

// 1. desliga o rendering padrão por frame (performance)
await meeting.self.setVideoMiddlewareGlobalConfig({ disablePerFrameCanvasRendering: true });

// 2. checa suporte do browser
if (RealtimeKitVideoBackgroundTransformer.isSupported()) {
  // 3. inicializa
  const videoBackgroundTransformer = await RealtimeKitVideoBackgroundTransformer.init({ meeting });

  // Fundo estático (imagem precisa de CORS habilitado)
  meeting.self.addVideoMiddleware(
    await videoBackgroundTransformer.createStaticBackgroundVideoMiddleware(imageUrl)
  );

  // Blur (0-100, default 50)
  meeting.self.addVideoMiddleware(
    await videoBackgroundTransformer.createBackgroundBlurVideoMiddleware(50)
  );

  // Remover
  meeting.self.removeVideoMiddleware();
}
```

Config avançada de segmentação: `segmentationConfig: { model: "mlkit"|"meet", backend: "wasmSimd", inputResolution: "256x256", pipeline: "webgl2"|"canvas2dCpu", targetFps: 35 }`.
Fonte: https://developers.cloudflare.com/realtime/realtimekit/humans/core/video-effects/

**Habilitar na UI Kit** (abstração de mais alto nível, sem lidar com o transformer manualmente): usar o componente `rtk-meeting`/`RtkMeeting` com **UI Kit Addons** em vez do Core SDK direto.
Fonte: https://developers.cloudflare.com/realtime/realtimekit/humans/ui-kit/addons/ (referenciado em https://developers.cloudflare.com/realtime/realtimekit/humans/core/video-effects/)

---

## 8. React UI Kit — layout customizado

### Pacotes

```bash
npm i @cloudflare/realtimekit-react @cloudflare/realtimekit-react-ui
```
Fonte: https://developers.cloudflare.com/realtime/realtimekit/quickstart/

### Inicializar e entrar automaticamente (sem tela de setup)

```tsx
import { useEffect } from "react";
import {
  useRealtimeKitClient,
  useRealtimeKitMeeting,
  RealtimeKitProvider,
} from "@cloudflare/realtimekit-react";
import { RtkMeeting } from "@cloudflare/realtimekit-react-ui";

export default function App() {
  const [meeting, initMeeting] = useRealtimeKitClient();

  useEffect(() => {
    initMeeting({ authToken: "<auth-token>" });
  }, []);

  return (
    <RealtimeKitProvider value={meeting}>
      <MyMeetingUI />
    </RealtimeKitProvider>
  );
}

function MyMeetingUI() {
  const { meeting } = useRealtimeKitMeeting();
  // showSetupScreen={false} pula a tela de preview de câmera/mic e entra direto
  return <RtkMeeting mode="fill" meeting={meeting} showSetupScreen={false} />;
}
```
`showSetupScreen={true}` é o padrão no quickstart oficial; `false` entra direto na call.
Fonte: https://developers.cloudflare.com/realtime/realtimekit/quickstart/

Quanto a `defaults: { audio: false, video: false }` em `initMeeting`/`RealtimeKitClient.init`: o levantamento confirmou o padrão de entrar com câmera/mic desligados é controlado nas opções de mídia do `init` (via `meeting.self.setupTracks({ audio, video })`/config de defaults), mas a doc não detalha um objeto `defaults.audio/video` explícito nesta pesquisa — ver Lacunas.

### Layout customizado (controlbar própria) — substitui `RtkControlbar` default

```jsx
import { useRef } from "react";
import {
  RtkFullscreenToggle, RtkSettingsToggle, RtkScreenShareToggle,
  RtkMicToggle, RtkCameraToggle, RtkStageToggle, RtkLeaveButton,
  RtkMoreToggle, RtkPipToggle, RtkMuteAllButton, RtkBreakoutRoomsToggle,
  RtkRecordingToggle, RtkChatToggle, RtkPollsToggle,
  RtkParticipantsToggle, RtkPluginsToggle,
} from "@cloudflare/realtimekit-ui"; // (equivalente -react para componentes React puros)

function CustomControlbar({ fullScreenRef }) {
  return (
    <div style={{ display: "flex", width: "100%", padding: "8px 12px", justifyContent: "space-between" }}>
      <div style={{ display: "flex" }}>
        <RtkFullscreenToggle targetElement={fullScreenRef.current} />
        <RtkSettingsToggle />
        <RtkScreenShareToggle />
      </div>
      <div style={{ display: "flex" }}>
        <RtkMicToggle />
        <RtkCameraToggle />
        <RtkStageToggle />
        <RtkLeaveButton />
        <RtkMoreToggle>
          <div slot="more-elements">
            <RtkPipToggle variant="horizontal" />
            <RtkMuteAllButton variant="horizontal" />
            <RtkBreakoutRoomsToggle variant="horizontal" />
            <RtkRecordingToggle variant="horizontal" />
          </div>
        </RtkMoreToggle>
      </div>
      <div style={{ display: "flex" }}>
        <RtkChatToggle />
        <RtkPollsToggle />
        <RtkParticipantsToggle />
        <RtkPluginsToggle />
      </div>
    </div>
  );
}
```
Fonte: https://developers.cloudflare.com/realtime/realtimekit/humans/ui-kit/custom-controlbar/

Outros componentes React citados na documentação oficial (listagem de componentes, `.../ui-kit/api-reference/react/`): `RtkGrid`, `RtkSimpleGrid`, `RtkMixedGrid`, `RtkSpotlightGrid`, `RtkAudioGrid`, `RtkGridPagination`, `RtkParticipantTile`, `RtkParticipants`, `RtkParticipantCount`, `RtkParticipantToggle`, `RtkRecordingIndicator`, `RtkRecordingToggle`, `RtkChat`, `RtkChatToggle`, `RtkChatHeader`, `RtkChatComposerUi/View`, `RtkSidebar`, `RtkNotification`, `RtkNotifications`, `RtkScreenShareToggle`, `RtkBreakoutRoomManager`, `RtkBreakoutRoomsToggle`, `RtkAi`, `RtkAiToggle`, `RtkAiTranscriptions`, `RtkCaptionToggle`, `RtkPolls`, `RtkPollForm`, `RtkPluginMain`, `RtkPluginsToggle`, `RtkSettings*`, `RtkAvatar`, `RtkButton`, `RtkMenu/RtkMenuItem/RtkMenuList`, `RtkUIProvider`, `RtkSetupScreen`, `RtkIdleScreen`, `RtkWaitingScreen`, `RtkEndedScreen`. Não há no levantamento um componente dedicado "RtkScreenshareView" no React (web) — o equivalente listado explicitamente é `RtkScreenshareView` no pacote **React Native**; no Web a visualização de compartilhamento de tela parece ficar embutida em `RtkGrid`/`RtkParticipantTile` — ver Lacunas.
Fonte: https://developers.cloudflare.com/realtime/llms.txt (listagem de páginas de componentes React/React Native)

### Theming / branding

Função: **`provideRtkDesignSystem()`**.

```js
provideRtkDesignSystem({
  googleFont: "Lobster",
  theme: "light", // "light" | "dark" | "darkest"
  colors: {
    danger: "#ffac00",
    brand: { 300: "#00FFE1", 500: "#00E1D4", 700: "#00655F" },
    text: "#071428",
    "text-on-brand": "#ffffff",
    "video-bg": "#E5E7EB",
  },
  borderRadius: "extra-rounded", // sharp | rounded | extra-rounded | circular
  spacingBase: 4,
});
```
Tokens cobertos: cores (brand 300–700, background 600–1000, texto, status danger/success/warning, video-bg), tipografia (`fontFamily` custom ou `googleFont` auto-carregada), `spacingBase` (default 4px), `borderRadius`, `borderWidth` (`none`/`thin`/`fat`).
Fonte: https://developers.cloudflare.com/realtime/realtimekit/humans/ui-kit/branding/design-system/

Isso é o mesmo esquema de `ui.design_tokens` que também pode ser definido por **Preset** via API (seção 2) — ou seja, dá pra brandar tanto no código do client quanto centralizado no preset.

### Eventos de participante entrando/saindo no SDK

```js
// qualquer participante entra
meeting.participants.joined.on("participantJoined", (participant) => {
  console.log(`A participant with id "${participant.id}" has joined`);
});

// qualquer participante sai
meeting.participants.joined.on("participantLeft", (participant) => {
  console.log(`A participant with id "${participant.id}" has left the meeting`);
});
```
Em React: `const joinedParticipants = useRealtimeKitSelector((m) => m.participants.joined);` para estado reativo, ou os listeners acima dentro de um `useEffect`.
Outros eventos do mesmo mapa: `pinned`, `unpinned`, `videoUpdate`; eventos de grid: `viewModeChanged`, `pageChanged`, `activeSpeaker`.
Fonte: https://developers.cloudflare.com/realtime/realtimekit/humans/core/remote-participants/events/

### Next.js / SSR

A documentação oficial do RealtimeKit **não traz uma página dedicada a Next.js/SSR** neste levantamento (`llms.txt` não lista nada do tipo). Pelo próprio uso de APIs de browser (WebRTC, `MediaDevices`, Custom Elements no caso do pacote Web Components), a integração é implicitamente **client-only**: os exemplos oficiais usam Vite/React puro, nunca Next.js. Recomendação de mercado (não confirmada nesta doc) é usar `dynamic(() => import(...), { ssr: false })` ou marcar o componente com `"use client"` — tratar como lacuna a confirmar com teste próprio.
Fonte da ausência: https://developers.cloudflare.com/realtime/llms.txt (nenhuma entrada "Next.js"/"SSR" nas +300 páginas de RealtimeKit)

---

## 9. Pricing

| Item | Preço | 
|---|---|
| Audio/Video Participant | $0.002 / minuto |
| Audio-Only Participant | $0.0005 / minuto |
| Export (recording, RTMP ou HLS streaming) | $0.010 / minuto |
| Export (recording/RTMP/HLS, somente áudio) | $0.003 / minuto |
| Export (Raw RTP) para R2 | $0.0005 / minuto |
| Transcrição em tempo real | preço padrão do modelo via Workers AI (variável) |

"Whether a participant is an audio-only participant or an audio/video participant is determined by the Meeting Type of their preset." Não há menção de free tier/créditos grátis nesta página.
Calculadora oficial: https://realtime.cloudflare.com/#pricing-calculator
Fonte: https://developers.cloudflare.com/realtime/realtimekit/platform/pricing/ (última atualização listada: 19/10/2026)

Regras de billing (FAQ):
- Adicionar participante (Add Participant API) **não cobra** — só cobra quando ele efetivamente entra na sessão.
- Cobrança por segundo de presença ativa, mesmo sem produzir/consumir mídia.
- Múltiplas abas com o mesmo token são cobradas **separadamente** (uma cobrança por aba/conexão).
- Criar meetings e tokens não tem custo.
Fonte: https://developers.cloudflare.com/realtime/realtimekit/faq/

Webinar: presenters e viewers são ambos cobrados como "Audio/Video Participant".
Fonte: https://developers.cloudflare.com/realtime/realtimekit/webinar/

---

## 10. Limites

### Limites de API (rate limit)

| API | Limite |
|---|---|
| Todas as APIs RealtimeKit | 3.500 requisições / 5 minutos |
| APIs de Recording | 1.000 requisições / 50 segundos |

(Contam no limite global do `api.cloudflare.com`.)

### Limites de SDK (por participante, por sessão ativa — não compartilhado entre participantes nem agregado por app)

| Operação | Limite |
|---|---|
| Escrever no meeting key-value store (`set/update/delete/bulkSet/bulkDelete`) | 5/segundo |
| `broadcastMessage()` | 5/segundo |
| `sendTextMessage()` | 180/minuto |
| `sendMessage()` | 180/minuto |
| `sendImageMessage()` | 20/minuto |
| `sendFileMessage()` | 20/minuto |
| `getConnectedMeetings()` | 60/minuto |
| `getAllJoinedPeers()` | 10/minuto |
| `updatePermissions()` | 1.000/minuto |

Fonte: https://developers.cloudflare.com/realtime/realtimekit/platform/limits/

### Máximo de participantes por meeting / tiles em tela

- A doc de Limits **não publica** um teto numérico fixo de participantes simultâneos por meeting (nem por plano) — ela só documenta rate limits de API/SDK e aponta para "Data retention" como página irmã.
- Existe um **error code 1206** ("Max participants limit reached" — "The meeting has reached its maximum participant capacity... upgrade your plan for higher limits"), confirmando que existe um teto, mas sem o número exato documentado publicamente.
- Grid/tiles em tela: `meeting.participants.active` (participantes exibidos no grid) é limitado por `maxActiveParticipantsCount`, que é "**um a menos que o grid size configurado no Preset**" do participante local (reserva espaço pro próprio usuário) — ex.: grid size 6 → até 5 participantes remotos em `active`. Pode-se alterar com `meeting.participants.setMaxActiveParticipantsCount(limit)`.
- Changelog menciona suporte a "participant grids with up to 100 participants per page" (aumentado de 24/página) — não é um limite "oficial" documentado como spec, é uma entrada de release notes.
Fonte: https://developers.cloudflare.com/realtime/realtimekit/platform/limits/, https://developers.cloudflare.com/realtime/realtimekit/humans/core/remote-participants/ (erro 1206), https://developers.cloudflare.com/realtime/realtimekit/humans/core/api-reference/rtkparticipants/ (`maxActiveParticipantsCount`)

---

## Lacunas

Itens que não foi possível confirmar com uma citação direta e precisa na documentação oficial, mesmo com busca extensiva:

1. **Número exato de limite de participantes por meeting/plano.** Confirmado que existe um teto (error code 1206), mas o valor numérico não é publicado na página de Limits nem em Pricing.
2. **Comportamento exato de `defaults.audio`/`defaults.video` em `RealtimeKitClient.init`/`initMeeting`** para forçar entrada sem câmera/mic ligados — a pesquisa confirma que `meeting.self.setupTracks({audio, video})` existe e que o preset controla se o guest **pode** ligar mic/cam (`can_produce`), mas não achei a doc específica que amarra "estado inicial ligado/desligado ao entrar" a um campo de preset ou a uma opção do `init()` chamada exatamente assim.
3. **`RtkScreenshareView` no pacote Web/React** — esse nome de componente só apareceu confirmado no pacote React Native; no Web a pesquisa não achou um componente "screenshare view" com esse nome exato (pode estar embutido em `RtkGrid`/`RtkParticipantTile` ou ter outro nome).
4. **Caveats específicos de Next.js/SSR** (client-only, `dynamic import`) — não há página oficial dedicada; é inferência baseada no uso de WebRTC/browser APIs, não uma citação direta.
5. **Endpoint REST dedicado para baixar o chat exportado** fora do webhook `meeting.chatSynced` — só confirmei o fluxo via webhook (`chatDownloadUrl`), não um "GET chat export" chamável sob demanda.
6. **Nomes exatos de todos os métodos de envio de chat** (`sendImageMessage`, `sendFileMessage`) — inferidos pela tabela de rate limits da página de Limits, não vistos como assinatura de método documentada na página de Chat em si.
7. **Semântica exata do `waiting_room_type` como nomes de API** (`SKIP`, `ON_PRIVILEGED_USER_ENTRY`, `SKIP_ON_ACCEPT`) comparada 1:1 com os três comportamentos descritos em prosa na doc de conceitos — a correspondência entre enum e descrição textual é minha inferência razoável, não uma tabela que a Cloudflare publica lado a lado.
8. **Free tier/créditos grátis de pricing** — a página de Pricing não menciona nenhum tier gratuito; não confirmei se existe ou não via outra fonte oficial.
