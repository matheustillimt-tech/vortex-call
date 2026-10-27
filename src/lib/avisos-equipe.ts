import "server-only";
import { siteUrl } from "./env";
import { montarCabecalhos, postar, type RespostaPost } from "./eventos";
import {
  atualizarEmBreve,
  corpoEmBreve,
  corpoNovoAgendamento,
  corpoResumoDiario,
  dadosDoVendedor,
  deveAvisarEmBreve,
  diaDoResumo,
  idAvisoEquipe,
  MINUTOS_EM_BREVE,
  resumoDaFicha,
  type CorpoAvisoEquipe,
  type EventoEquipe,
  type SessaoDoDia,
} from "./regras/avisos-equipe";
import { mascararContatosNoTexto, mascararEmail, mascararSeContato, mascararWhatsapp } from "./regras/contato";
import { proximaTentativa, urlValida } from "./regras/eventos";
import { pode } from "./regras/permissoes";
import { respostasDoFormulario } from "./regras/ficha";
import { dbAdmin } from "./supabase/admin";

/** Avisos pro vendedor responsável pela agenda, no WhatsApp dele, pelo CRM: mesma mecânica dos eventos do
 *  lead (fila no banco, entrega pela rotina de 1 em 1 min, tentativas, `X-Webhook-Secret`, `id_evento` único), mas
 *  com UMA URL e UM segredo pra equipe toda (`configuracao.crm_url_equipe` / `crm_segredo_equipe`, em Configurações).
 *  Só enfileira quando a agenda tem responsável ativo com WhatsApp e a URL está configurada. Texto fixo (sem IA). */

type Db = ReturnType<typeof dbAdmin>;
type Vendedor = { id: string; nome: string; whatsapp: string; papel?: "admin" | "membro"; permissoes?: unknown };
type Agenda = { id: string; nome: string; slug: string; responsavel_id: string | null };

const MIN = 60_000;
const TAMANHO_RESPOSTA = 500;
const LIMITE_PADRAO = 20;

async function configEquipe(db: Db): Promise<{ url: string | null; segredo: string | null }> {
  const { data } = await db.from("configuracao").select("crm_url_equipe, crm_segredo_equipe").eq("id", 1).maybeSingle();
  const c = data as { crm_url_equipe?: string | null; crm_segredo_equipe?: string | null } | null;
  const url = c?.crm_url_equipe && urlValida(c.crm_url_equipe) ? c.crm_url_equipe : null;
  return { url, segredo: c?.crm_segredo_equipe ?? null };
}

/** Vendedores ativos e com WhatsApp, por id. */
async function vendedores(db: Db, ids: string[]): Promise<Map<string, Vendedor>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();
  const { data } = await db.from("usuarios").select("id, nome, whatsapp, ativo, papel, permissoes").in("id", unicos);
  const lista = ((data ?? []) as (Vendedor & { whatsapp: string | null; ativo: boolean })[]).filter((u) => u.ativo && u.whatsapp);
  return new Map(lista.map((u) => [u.id, { id: u.id, nome: u.nome, whatsapp: u.whatsapp as string, papel: u.papel, permissoes: u.permissoes }]));
}

function primeiro<T>(v: T | T[] | null | undefined): T | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

async function enfileirar(
  db: Db,
  corpo: CorpoAvisoEquipe,
  o: { usuario: string; sessao: string | null; agenda: string | null; inscricao?: string | null },
): Promise<boolean> {
  const { data, error } = await db.rpc("enfileirar_aviso_equipe", {
    p_id_evento: corpo.id_evento,
    p_evento: corpo.evento,
    p_usuario: o.usuario,
    p_sessao: o.sessao,
    p_agenda: o.agenda,
    p_corpo: corpo,
    p_sem_destino: false,
    p_inscricao: o.inscricao ?? null,
  });
  if (error) throw new Error("Não foi possível enfileirar o aviso da equipe.");
  return Boolean(data);
}

/** Lead agendou (ou reagendou pra outra sessão) numa agenda com vendedor: avisa o vendedor. `false` = não tinha pra
 *  quem/onde mandar (ou já estava na fila). Lança em dado órfão ou erro do banco (quem chama decide). */
export async function avisarNovoAgendamento(inscricaoId: string, reagendou: boolean, agora: Date = new Date()): Promise<boolean> {
  const db = dbAdmin();
  const { url } = await configEquipe(db);
  if (!url) return false;

  const { data: inscData } = await db.from("inscricoes").select("id, nome, whatsapp, email, sessao_id, respostas, agendado_em").eq("id", inscricaoId).maybeSingle();
  if (!inscData) throw new Error("Inscrição não encontrada.");
  const insc = inscData as {
    id: string; nome: string; whatsapp: string; email: string | null; sessao_id: string; respostas: unknown; agendado_em: string;
  };
  const { data: sessaoData } = await db.from("sessoes").select("id, titulo, inicio, agenda_id").eq("id", insc.sessao_id).maybeSingle();
  if (!sessaoData) throw new Error("Sessão não encontrada.");
  const sessao = sessaoData as { id: string; titulo: string | null; inicio: string; agenda_id: string };
  const { data: agendaData } = await db.from("agendas").select("id, nome, slug, responsavel_id").eq("id", sessao.agenda_id).maybeSingle();
  if (!agendaData) throw new Error("Agenda não encontrada.");
  const agenda = agendaData as Agenda;
  if (!agenda.responsavel_id) return false;
  const vendedor = (await vendedores(db, [agenda.responsavel_id])).get(agenda.responsavel_id);
  if (!vendedor) return false;

  const { data: ficha } = await db.from("fichas").select("resumo_ia").eq("whatsapp", insc.whatsapp).maybeSingle();
  // Vendedor sem a permissão `contato_lead`: o aviso leva o WhatsApp/e-mail do lead mascarados (e as respostas que
  // forem contato também).
  const contato = pode({ papel: vendedor.papel ?? "membro", permissoes: vendedor.permissoes }, "contato_lead");
  const respostas = respostasDoFormulario(insc.respostas);
  const resumoBruto = resumoDaFicha({
    resumoIa: (ficha as { resumo_ia?: string | null } | null)?.resumo_ia,
    respostas: contato ? respostas : respostas.map((r) => ({ ...r, resposta: mascararSeContato(r.resposta) })),
  });
  const resumo = resumoBruto && !contato ? mascararContatosNoTexto(resumoBruto) : resumoBruto;
  const corpo = corpoNovoAgendamento({
    vendedor,
    lead: {
      id: insc.id,
      nome: insc.nome,
      whatsapp: contato ? insc.whatsapp : mascararWhatsapp(insc.whatsapp),
      email: contato ? insc.email : mascararEmail(insc.email),
      agendado_em: insc.agendado_em ?? agora.toISOString(),
    },
    sessao,
    agenda,
    resumo,
    reagendou,
    site: siteUrl(),
    agora,
  });
  return enfileirar(db, corpo, { usuario: vendedor.id, sessao: sessao.id, agenda: agenda.id, inscricao: insc.id });
}

type SessaoComAgenda = { id: string; titulo: string | null; inicio: string; agenda_id: string; agendas: unknown };

/** Inscrições ativas (`agendado`) por sessão. Pelo servidor (service role): a equipe não lê `inscricoes` inteira pelo
 *  próprio login (grant por coluna), e o embed `inscricoes(count)` do PostgREST exige o grant da tabela toda. Quem chama
 *  passa só ids de sessões que a pessoa já pode ver; aqui só sai a contagem. */
export async function inscritosPorSessao(db: Db, ids: string[]): Promise<Map<string, number>> {
  const contagem = new Map<string, number>();
  if (ids.length === 0) return contagem;
  const { data, error } = await db.from("inscricoes").select("sessao_id").in("sessao_id", ids).eq("status", "agendado");
  if (error) throw new Error("Não foi possível contar os inscritos.");
  for (const i of (data ?? []) as { sessao_id: string }[]) contagem.set(i.sessao_id, (contagem.get(i.sessao_id) ?? 0) + 1);
  return contagem;
}

/** Cron: ~10 min antes de cada sessão (agendada ou já aberta) com pelo menos um inscrito ativo, avisa o vendedor da
 *  agenda. Uma vez por sessão (`id_evento`). Devolve quantos entraram na fila. */
export async function enfileirarAvisosEmBreve(agora: Date = new Date()): Promise<number> {
  const db = dbAdmin();
  const { url } = await configEquipe(db);
  if (!url) return 0;
  const { data, error } = await db
    .from("sessoes")
    .select("id, titulo, inicio, agenda_id, agendas(id, nome, slug, responsavel_id)")
    .in("status", ["agendada", "ao_vivo"])
    .gt("inicio", agora.toISOString())
    .lte("inicio", new Date(agora.getTime() + MINUTOS_EM_BREVE * MIN).toISOString());
  if (error) throw new Error("Não foi possível listar as sessões.");
  const sessoes = ((data ?? []) as SessaoComAgenda[])
    .map((s) => ({ ...s, agenda: primeiro(s.agendas as Agenda | Agenda[] | null) }))
    .filter((s) => s.agenda?.responsavel_id && deveAvisarEmBreve(new Date(s.inicio), agora));
  if (sessoes.length === 0) return 0;

  const inscritos = await inscritosPorSessao(db, sessoes.map((s) => s.id));
  const porId = await vendedores(db, sessoes.map((s) => s.agenda!.responsavel_id!));
  let n = 0;
  for (const s of sessoes) {
    const total = inscritos.get(s.id) ?? 0;
    const vendedor = porId.get(s.agenda!.responsavel_id!);
    if (total === 0 || !vendedor) continue;
    try {
      const corpo = corpoEmBreve({ vendedor, sessao: s, agenda: s.agenda!, inscritos: total, site: siteUrl(), agora });
      if (await enfileirar(db, corpo, { usuario: vendedor.id, sessao: s.id, agenda: s.agenda!.id })) n++;
    } catch (e) {
      console.error("[equipe] não enfileirou em breve", s.id, e instanceof Error ? e.message : "erro");
    }
  }
  return n;
}

/** Cron: às 08:00 (Brasília; até 09:59 se o cron atrasar) manda a cada vendedor a lista das calls de hoje das agendas
 *  dele que ainda vão acontecer (início a partir de agora), com hora e inscritos. Uma vez por vendedor por dia (`id_evento`); sem sessão hoje, nada. */
export async function enfileirarResumosDiarios(agora: Date = new Date()): Promise<number> {
  const janela = diaDoResumo(agora);
  if (!janela) return 0;
  const db = dbAdmin();
  const { url } = await configEquipe(db);
  if (!url) return 0;
  const { data, error } = await db
    .from("sessoes")
    .select("id, titulo, inicio, agenda_id, agendas(id, nome, slug, responsavel_id)")
    .in("status", ["agendada", "ao_vivo"])
    .gte("inicio", new Date(Math.max(janela.de.getTime(), agora.getTime())).toISOString())
    .lt("inicio", janela.ate.toISOString());
  if (error) throw new Error("Não foi possível listar as sessões de hoje.");

  const porVendedor = new Map<string, (SessaoComAgenda & { agenda: Agenda })[]>();
  for (const s of (data ?? []) as SessaoComAgenda[]) {
    const agenda = primeiro(s.agendas as Agenda | Agenda[] | null);
    if (!agenda?.responsavel_id) continue;
    porVendedor.set(agenda.responsavel_id, [...(porVendedor.get(agenda.responsavel_id) ?? []), { ...s, agenda }]);
  }
  if (porVendedor.size === 0) return 0;

  // Já na fila hoje: não refaz o trabalho a cada minuto da janela (o `id_evento` único é a garantia de verdade).
  const ids = [...porVendedor.keys()].map((u) => idAvisoEquipe({ evento: "vendedor_resumo_diario", usuario: u, dia: janela.dia }));
  const { data: naFila } = await db.from("avisos_equipe").select("id_evento").in("id_evento", ids);
  const jaNaFila = new Set(((naFila ?? []) as { id_evento: string }[]).map((a) => a.id_evento));
  const pendentes = [...porVendedor.entries()].filter(
    ([u]) => !jaNaFila.has(idAvisoEquipe({ evento: "vendedor_resumo_diario", usuario: u, dia: janela.dia })),
  );
  if (pendentes.length === 0) return 0;

  const todas = pendentes.flatMap(([, ss]) => ss.map((s) => s.id));
  const inscritos = await inscritosPorSessao(db, todas);
  const porId = await vendedores(db, pendentes.map(([u]) => u));
  let n = 0;
  for (const [usuario, ss] of pendentes) {
    const vendedor = porId.get(usuario);
    if (!vendedor) continue;
    // Só as calls com inscrito: agenda de horário fixo tem várias sessões vazias por
    // dia. Sem nenhuma com inscrito, não sai (se alguém agendar dentro da janela das 8h às 9h59, sai depois).
    const sessoes: SessaoDoDia[] = ss
      .map((s) => ({ id: s.id, titulo: s.titulo, inicio: s.inicio, agenda: s.agenda.nome, inscritos: inscritos.get(s.id) ?? 0 }))
      .filter((s) => s.inscritos > 0);
    if (sessoes.length === 0) continue;
    try {
      const corpo = corpoResumoDiario({ vendedor, dia: janela.dia, sessoes, site: siteUrl(), agora });
      if (await enfileirar(db, corpo, { usuario, sessao: null, agenda: null })) n++;
    } catch (e) {
      console.error("[equipe] não enfileirou o resumo diário", usuario, e instanceof Error ? e.message : "erro");
    }
  }
  return n;
}

type AvisoPendente = {
  id: string;
  id_evento: string;
  evento: EventoEquipe;
  usuario_id: string;
  sessao_id: string | null;
  inscricao_id: string | null;
  tentativas: number;
  corpo: Record<string, unknown>;
};

/** O aviso ainda vale? Sessão cancelada (ou apagada) = não; "em breve" de sessão que já começou = não; novo
 *  agendamento de quem já mudou de sessão = não. */
async function avisoAindaVale(db: Db, a: AvisoPendente, agora: Date): Promise<boolean> {
  if (a.sessao_id) {
    const { data } = await db.from("sessoes").select("status, inicio").eq("id", a.sessao_id).maybeSingle();
    const sessao = data as { status: string; inicio: string } | null;
    if (!sessao || sessao.status === "cancelada") return false;
    if (a.evento === "vendedor_sessao_em_breve" && agora.getTime() >= Date.parse(sessao.inicio)) return false;
  }
  if (a.evento === "vendedor_novo_agendamento" && a.inscricao_id) {
    const { data } = await db.from("inscricoes").select("sessao_id, status").eq("id", a.inscricao_id).maybeSingle();
    const i = data as { sessao_id: string; status: string } | null;
    if (!i || i.sessao_id !== a.sessao_id || i.status === "cancelado") return false;
  }
  return true;
}

async function marcar(db: Db, id: string, valores: Record<string, unknown>, rotulo: string) {
  const { error } = await db.from("avisos_equipe").update(valores).eq("id", id);
  if (error) console.error("[equipe] aviso não marcado", rotulo);
}

async function entregarUm(
  db: Db,
  a: AvisoPendente,
  cfg: { url: string | null; segredo: string | null },
  agora: Date,
): Promise<"enviado" | "falha" | "sem_destino"> {
  if (!cfg.url) {
    await marcar(db, a.id, { status: "sem_destino" }, a.id_evento);
    return "sem_destino";
  }
  // Vendedor desativado ou sem WhatsApp agora (mudou depois de enfileirar): não manda. Senão vai o WhatsApp de agora.
  const vendedor = (await vendedores(db, [a.usuario_id])).get(a.usuario_id);
  if (!vendedor) {
    await marcar(db, a.id, { status: "sem_destino", resposta: "vendedor sem WhatsApp" }, a.id_evento);
    return "sem_destino";
  }
  if (!(await avisoAindaVale(db, a, agora))) {
    await marcar(db, a.id, { status: "sem_destino", resposta: "obsoleto" }, a.id_evento);
    return "sem_destino";
  }
  let corpo: Record<string, unknown> = { ...a.corpo, vendedor: dadosDoVendedor(vendedor), enviado_em: agora.toISOString() };
  if (a.evento === "vendedor_sessao_em_breve") corpo = atualizarEmBreve(corpo as { vendedor: unknown; mensagem: unknown; dados: unknown }, agora);
  const corpoTexto = JSON.stringify(corpo);
  let resposta: RespostaPost | null = null;
  let erroRede: unknown = null;
  try {
    resposta = await postar(cfg.url, montarCabecalhos(cfg.segredo, corpoTexto), corpoTexto);
  } catch (e) {
    erroRede = e;
  }
  if (resposta?.ok) {
    await marcar(db, a.id, { status: "enviado", enviado_em: agora.toISOString(), resposta_status: resposta.status, resposta: resposta.texto.slice(0, TAMANHO_RESPOSTA) }, a.id_evento);
    return "enviado";
  }
  const tentativas = a.tentativas + 1;
  const proxima = proximaTentativa(tentativas, agora);
  const texto = (resposta?.texto ?? "").slice(0, TAMANHO_RESPOSTA);
  await marcar(
    db,
    a.id,
    proxima
      ? { status: "pendente", tentativas, proxima_em: proxima.toISOString(), resposta_status: resposta?.status ?? null, resposta: texto }
      : { status: "falhou", tentativas, resposta_status: resposta?.status ?? null, resposta: texto },
    a.id_evento,
  );
  console.warn("[equipe] envio falhou", a.evento, resposta?.status ?? (erroRede instanceof Error ? erroRede.message : "erro"));
  return "falha";
}

/** Entrega os avisos da equipe pendentes (lote de até `limite`, um por vez — o volume é pequeno), com reivindicação
 *  (lease de 2 min) igual à dos eventos do lead. URL e segredo lidos na hora (correção no painel vale já). Com
 *  `prazo`, nenhum POST novo começa depois dele; o que sobrar volta pra fila quando o lease vence. */
export async function entregarAvisosEquipe(agora: Date = new Date(), limite: number = LIMITE_PADRAO, prazo?: Date): Promise<{ enviados: number; falhas: number }> {
  const db = dbAdmin();
  const { data } = await db.rpc("reivindicar_avisos_equipe", { p_limite: limite, p_agora: agora.toISOString() });
  const pendentes = (data ?? []) as AvisoPendente[];
  if (pendentes.length === 0) return { enviados: 0, falhas: 0 };
  const cfg = await configEquipe(db);
  let enviados = 0;
  let falhas = 0;
  for (const a of pendentes) {
    if (prazo && Date.now() >= prazo.getTime()) break;
    try {
      const r = await entregarUm(db, a, cfg, agora);
      if (r === "enviado") enviados++;
      else if (r === "falha") falhas++;
    } catch (e) {
      falhas++;
      console.warn("[equipe] envio falhou", a.evento, e instanceof Error ? e.message : "erro");
    }
  }
  return { enviados, falhas };
}
