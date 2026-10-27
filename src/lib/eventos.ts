import "server-only";
import { siteUrl } from "./env";
import { assinarCorpo, EVENTOS_DISPARO, idEvento, idEventoDisparo, montarCorpo, proximaTentativa, urlValida, type NomeEvento, type VendaDoEvento } from "./regras/eventos";
import { respostasDoFormulario } from "./regras/ficha";
import { corpoParaEnvio, dadosDoCorpo, mensagemPadrao } from "./regras/mensagem";
import { dbAdmin } from "./supabase/admin";

const TEMPO_LIMITE_MS = 5_000;
const LIMITE_PADRAO = 50;
const ENVIOS_SIMULTANEOS = 5;
const TAMANHO_RESPOSTA = 500;

type Inscricao = {
  id: string;
  codigo: string;
  nome: string;
  whatsapp: string;
  email: string | null;
  sessao_id: string;
  minutos_na_sala?: number;
};
type Sessao = { id: string; titulo: string | null; inicio: string; agenda_id: string };
type Agenda = { id: string; slug: string; nome: string; crm_urls: Record<string, string> | null; disparo_url: string | null };
type Destino = "crm" | "disparo";

function urlDoEvento(crmUrls: Record<string, string> | null | undefined, evento: NomeEvento): string | null {
  const url = crmUrls?.[evento];
  return url && urlValida(url) ? url : null;
}

/** URL de disparo (API oficial) da agenda, só pros eventos que viram mensagem pro lead. */
function urlDeDisparo(disparoUrl: string | null | undefined, evento: NomeEvento): string | null {
  return disparoUrl && urlValida(disparoUrl) && EVENTOS_DISPARO.includes(evento) ? disparoUrl : null;
}

/** Cabeçalhos do POST pro CRM: mesmos pro envio de fila (`entregarPendentes`) e pro "Enviar teste" do
 *  painel, pra que o teste mostre exatamente o que o CRM recebe de verdade. Sem segredo, não manda
 *  `X-Webhook-Secret` (o CRM confere por esse cabeçalho) nem `X-Vortex-Call-Assinatura` (HMAC com chave vazia
 *  não prova nada). */
export function montarCabecalhos(segredo: string | null, corpoTexto: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "User-Agent": "VortexCall/1",
  };
  if (segredo) {
    headers["X-Webhook-Secret"] = segredo;
    headers["X-Vortex-Call-Assinatura"] = assinarCorpo(segredo, corpoTexto);
  }
  return headers;
}

/** Monta o corpo do evento (dados de agora: lead, sessão, link) e enfileira no banco; o banco garante que um
 *  mesmo `id_evento` nunca entra duas vezes. Sem URL cadastrada pra esse evento na agenda, enfileira como
 *  `sem_destino` (não é erro: só não tem pra onde mandar). Lança erro se a inscrição, a sessão ou a agenda não
 *  existir (dado órfão) ou se a RPC der erro — propositalmente: quem chama decide se ignora ou propaga. `false`
 *  quer dizer só "já estava na fila". `opcoes.minutosNaSala` vale no lugar do que está gravado na inscrição (a
 *  avaliação de presença enfileira ANTES de gravar os minutos). `opcoes.resumo`: o resumo da call (evento `resumo`).
 *  `opcoes.venda`: a venda da Pay (evento `comprou`). */
export async function enfileirar(
  evento: NomeEvento,
  inscricaoId: string,
  agora: Date = new Date(),
  opcoes: { minutosNaSala?: number; resumo?: { texto: string; dados: unknown }; venda?: VendaDoEvento } = {},
): Promise<boolean> {
  const db = dbAdmin();
  const { data: inscricao } = await db.from("inscricoes").select("id, codigo, nome, whatsapp, email, sessao_id, minutos_na_sala, respostas").eq("id", inscricaoId).maybeSingle();
  if (!inscricao) throw new Error("Inscrição não encontrada.");
  const insc = inscricao as Inscricao;

  const { data: sessaoData } = await db.from("sessoes").select("id, titulo, inicio, agenda_id").eq("id", insc.sessao_id).maybeSingle();
  if (!sessaoData) throw new Error("Sessão não encontrada.");
  const sessao = sessaoData as Sessao;

  const { data: agendaData } = await db.from("agendas").select("id, slug, nome, crm_urls, disparo_url").eq("id", sessao.agenda_id).maybeSingle();
  if (!agendaData) throw new Error("Agenda não encontrada.");
  const agenda = agendaData as Agenda;

  const corpo = montarCorpo({
    evento,
    inscricao: {
      id: insc.id, codigo: insc.codigo, nome: insc.nome, whatsapp: insc.whatsapp, email: insc.email,
      minutos_na_sala: opcoes.minutosNaSala ?? insc.minutos_na_sala,
    },
    sessao: { id: sessao.id, titulo: sessao.titulo, inicio: sessao.inicio },
    agenda: { slug: agenda.slug, nome: agenda.nome },
    site: siteUrl(),
    agora,
    respostas: respostasDoFormulario((insc as Inscricao & { respostas?: unknown }).respostas),
    resumo: opcoes.resumo,
    venda: opcoes.venda,
  });

  const semDestino = urlDoEvento(agenda.crm_urls, evento) === null;

  const { data, error } = await db.rpc("enfileirar_evento", {
    p_id_evento: idEvento(evento, insc.id, sessao.id),
    p_evento: evento,
    p_inscricao: insc.id,
    p_sessao: sessao.id,
    p_agenda: agenda.id,
    p_corpo: corpo,
    p_sem_destino: semDestino,
  });
  if (error) throw new Error("Não foi possível enfileirar o evento.");

  // 2º destino: a URL de disparo (API oficial). Linha própria na fila, com o mesmo corpo.
  if (urlDeDisparo(agenda.disparo_url, evento)) {
    const { error: erroDisparo } = await db.rpc("enfileirar_evento", {
      p_id_evento: idEventoDisparo(evento, insc.id, sessao.id),
      p_evento: evento,
      p_inscricao: insc.id,
      p_sessao: sessao.id,
      p_agenda: agenda.id,
      p_corpo: corpo,
      p_sem_destino: false,
      p_destino: "disparo",
    });
    if (erroDisparo) throw new Error("Não foi possível enfileirar o disparo.");
  }
  return Boolean(data);
}

type EventoPendente = {
  id: string;
  id_evento: string;
  evento: NomeEvento;
  corpo: Record<string, unknown>;
  tentativas: number;
  agenda_id: string;
  inscricao_id: string;
  sessao_id: string | null;
  /** `crm` (CRM, URL por evento) ou `disparo` (URL de disparo da agenda). Linha antiga sem a coluna = `crm`. */
  destino?: Destino;
  /** Mensagem já gerada numa tentativa anterior (reenvio usa a mesma, sem chamar a IA de novo). */
  mensagem?: string | null;
};

export type RespostaPost = { ok: boolean; status: number; texto: string };

/** POST com tempo limite que cobre também a leitura do corpo da resposta: um CRM que manda o cabeçalho e trava
 *  no corpo não segura o cron. Estourou o tempo = lança (conta como falha de rede). */
export async function postar(url: string, headers: Record<string, string>, corpoTexto: string): Promise<RespostaPost> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const tempoEsgotado = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("tempo esgotado"));
    }, TEMPO_LIMITE_MS);
  });
  const envio = (async () => {
    const r = await fetch(url, { method: "POST", headers, body: corpoTexto, signal: controller.signal });
    const texto = await r.text().catch(() => "");
    return { ok: r.ok, status: r.status, texto };
  })();
  try {
    return await Promise.race([envio, tempoEsgotado]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/** O evento ainda vale? A inscrição tem que continuar na sessão do evento (reagendou = o aviso da sessão velha
 *  não serve mais) e a sessão não pode ter sido cancelada. */
async function eventoAindaVale(db: ReturnType<typeof dbAdmin>, evento: EventoPendente): Promise<boolean> {
  if (!evento.sessao_id) return false;
  const { data: insc } = await db.from("inscricoes").select("sessao_id").eq("id", evento.inscricao_id).maybeSingle();
  if (!insc || (insc as { sessao_id: string }).sessao_id !== evento.sessao_id) return false;
  const { data: sessao } = await db.from("sessoes").select("status").eq("id", evento.sessao_id).maybeSingle();
  return !!sessao && (sessao as { status: string }).status !== "cancelada";
}

/** Mensagem pronta do evento: a guardada (reenvio) ou o texto fixo padrão de `regras/mensagem.ts`. Desde
 *  26/10/2026 a IA não escreve mais os avisos: todo lead recebe o mesmo texto (só troca nome, data e link). */
function mensagemDoEvento(evento: EventoPendente): string {
  if (typeof evento.mensagem === "string") return evento.mensagem;
  return mensagemPadrao(evento.evento, dadosDoCorpo(evento.corpo));
}

async function entregarUm(
  db: ReturnType<typeof dbAdmin>,
  evento: EventoPendente,
  agora: Date,
  prazo?: Date,
): Promise<"enviado" | "falha" | "sem_destino"> {
  const { data: agendaData } = await db.from("agendas").select("crm_urls, crm_segredo, disparo_url").eq("id", evento.agenda_id).maybeSingle();
  const agenda = agendaData as { crm_urls: Record<string, string> | null; crm_segredo: string | null; disparo_url: string | null } | null;
  const disparo = evento.destino === "disparo";
  const url = disparo ? urlDeDisparo(agenda?.disparo_url, evento.evento) : urlDoEvento(agenda?.crm_urls, evento.evento);

  if (!url) {
    const { error } = await db.from("eventos").update({ status: "sem_destino" }).eq("id", evento.id);
    if (error) console.error("[crm] sem_destino mas não marcado", evento.id_evento);
    return "sem_destino";
  }

  if (!(await eventoAindaVale(db, evento))) {
    const { error } = await db.from("eventos").update({ status: "sem_destino", resposta: "obsoleto" }).eq("id", evento.id);
    if (error) console.error("[crm] obsoleto mas não marcado", evento.id_evento);
    return "sem_destino";
  }

  // A mensagem nasce aqui (na entrega, não ao enfileirar) e é guardada junto com o resultado do envio: no reenvio
  // vai a mesma.
  const mensagem = mensagemDoEvento(evento);
  // O segredo é do CRM: não vai pra URL de disparo.
  const segredo = disparo ? null : agenda?.crm_segredo ?? null;
  const corpoTexto = JSON.stringify(corpoParaEnvio(evento.evento, evento.corpo, mensagem));
  const headers = montarCabecalhos(segredo, corpoTexto);

  let resposta: RespostaPost | null = null;
  let erroRede: unknown = null;
  try {
    resposta = await postar(url, headers, corpoTexto);
  } catch (e) {
    erroRede = e;
  }

  if (resposta?.ok) {
    const { error } = await db.from("eventos").update({
      status: "enviado",
      mensagem,
      enviado_em: agora.toISOString(),
      resposta_status: resposta.status,
      resposta: resposta.texto.slice(0, TAMANHO_RESPOSTA),
    }).eq("id", evento.id);
    // O POST já saiu e deu 2xx: não tem como "desenviar". Se o update falhar, conta como enviado mesmo assim —
    // a reivindicação (lease de 2min) e o dedupe por id_evento no CRM fazem um possível reenvio ser inofensivo.
    if (error) console.error("[crm] enviado mas não marcado", evento.id_evento);
    return "enviado";
  }

  const textoFalha = resposta ? resposta.texto : "";
  const statusResposta = resposta ? resposta.status : null;
  const novasTentativas = evento.tentativas + 1;
  const proxima = proximaTentativa(novasTentativas, agora);

  const { error } = await db.from("eventos").update(
    proxima
      ? { status: "pendente", mensagem, tentativas: novasTentativas, proxima_em: proxima.toISOString(), resposta_status: statusResposta, resposta: textoFalha.slice(0, TAMANHO_RESPOSTA) }
      : { status: "falhou", mensagem, tentativas: novasTentativas, resposta_status: statusResposta, resposta: textoFalha.slice(0, TAMANHO_RESPOSTA) },
  ).eq("id", evento.id);
  if (error) console.error("[crm] falha não registrada", evento.id_evento);

  console.warn("[crm] envio falhou", evento.evento, statusResposta ?? (erroRede instanceof Error ? erroRede.message : "erro"));
  return "falha";
}

/** Entrega os eventos pendentes cuja hora já chegou (lote de até `limite`, mais antigos primeiro), até 5 POSTs ao
 *  mesmo tempo, cada um com 5 s de tempo limite (resposta inteira). Antes do POST, cada evento ganha a `mensagem`
 *  pronta (IA em até 8 s, terminando no `prazo`; senão texto fixo) e os `campos` do contato. Reivindica as linhas via `reivindicar_eventos`
 *  (lease de 2 minutos, `for update skip locked`) antes de mandar qualquer coisa: evita que duas chamadas que se
 *  sobrepõem (cron atrasado, instância duplicada) mandem o mesmo evento duas vezes. Com `prazo`, nenhum POST novo
 *  começa depois dele (o cron tem 60 s no total); o que ficou de fora volta pra fila quando o lease vence. URL e
 *  segredo são lidos da agenda nesse instante (não os de quando o evento foi enfileirado), pra que uma correção no
 *  painel valha já na próxima tentativa. Erro num item (rede, timeout, resposta ruim) não derruba os outros. */
export async function entregarPendentes(
  agora: Date = new Date(),
  limite: number = LIMITE_PADRAO,
  prazo?: Date,
): Promise<{ enviados: number; falhas: number }> {
  const db = dbAdmin();
  const { data } = await db.rpc("reivindicar_eventos", { p_limite: limite, p_agora: agora.toISOString() });

  const pendentes = (data ?? []) as EventoPendente[];
  let enviados = 0;
  let falhas = 0;
  let proximo = 0;

  const dentroDoPrazo = () => !prazo || Date.now() < prazo.getTime();

  async function trabalhador() {
    while (proximo < pendentes.length && dentroDoPrazo()) {
      const evento = pendentes[proximo++];
      try {
        const resultado = await entregarUm(db, evento, agora, prazo);
        if (resultado === "enviado") enviados++;
        else if (resultado === "falha") falhas++;
      } catch (e) {
        falhas++;
        console.warn("[crm] envio falhou", evento.evento, e instanceof Error ? e.message : "erro");
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(ENVIOS_SIMULTANEOS, pendentes.length) }, () => trabalhador()));
  if (proximo < pendentes.length) console.warn("[crm] prazo do cron: eventos ficaram pro próximo tick", pendentes.length - proximo);

  return { enviados, falhas };
}
