import "server-only";
import { after } from "next/server";
import { gravarAoAbrir } from "./gravacao";
import { fecharMeeting, participanteUnico } from "./participantes";
import { criarMeeting } from "./realtimekit";
import { ehCodigoValido } from "./regras/codigo";
import { presetDa } from "./regras/presets";
import { duracaoDaAgenda, estadoDaSala, MARGEM_FECHAR_MIN, prazoFinal, type EstadoSala } from "./regras/estado-sala";
import { dbAdmin } from "./supabase/admin";

/** `participante` é a pessoa de fora numa reunião instantânea (`src/lib/reunioes.ts`). `transcreve`: a sala está
 *  sendo transcrita (todos veem o aviso no topo). */
export type Passe = { token: string; nome: string; papel: "convidado" | "anfitriao" | "espiao" | "participante"; transcreve?: boolean };

/** Código inexistente, ou sessão/agenda apagada por baixo (dado órfão). */
export class RegistroNaoEncontrado extends Error {}

/** Sessão não está em estado que permita a ação (entrar como equipe, encerrar): já acabou, passou do prazo, ou
 *  (espião) ainda não foi aberta pelo anfitrião. */
export class SessaoIndisponivel extends Error {
  constructor(public status: string) {
    super("Sessão não está disponível.");
  }
}

type Contexto = {
  inscricao: { id: string; nome: string; status: string };
  sessao: { id: string; status: string; inicio: string; agenda_id: string };
  agenda: { duracao_min: number; abre_antes_min: number; slug: string };
  estado: EstadoSala;
  abreEm: Date;
};

async function contextoPorCodigo(codigo: string): Promise<Contexto | null> {
  if (!ehCodigoValido(codigo)) return null;
  const db = dbAdmin();
  const { data: inscricao } = await db.from("inscricoes").select("id, nome, status, sessao_id").eq("codigo", codigo).maybeSingle();
  if (!inscricao) return null;
  const { data: sessao } = await db.from("sessoes").select("id, status, inicio, agenda_id").eq("id", inscricao.sessao_id).maybeSingle();
  if (!sessao) return null;
  const { data: agenda } = await db.from("agendas").select("duracao_min, abre_antes_min, slug").eq("id", sessao.agenda_id).maybeSingle();
  if (!agenda) return null;
  const { estado, abreEm } = estadoDaSala({
    inscricao: inscricao.status,
    sessao: sessao.status,
    inicio: new Date(sessao.inicio),
    duracaoMin: agenda.duracao_min,
    abreAntesMin: agenda.abre_antes_min,
    agora: new Date(),
  });
  return { inscricao, sessao, agenda, estado, abreEm };
}

/** Lê `/c/{codigo}`: nenhum dado pessoal, só o que a tela precisa pra decidir o que mostrar. */
export async function estadoPorCodigo(codigo: string): Promise<null | { estado: EstadoSala; inicio: string; abreEm: string; slug: string }> {
  const ctx = await contextoPorCodigo(codigo);
  if (!ctx) return null;
  return { estado: ctx.estado, inicio: ctx.sessao.inicio, abreEm: ctx.abreEm.toISOString(), slug: ctx.agenda.slug };
}

/** Garante que a sessão tem uma meeting no RealtimeKit, criando só na primeira vez (reservada pela função SQL
 *  `reservar_meeting`, que resolve a corrida entre duas entradas simultâneas). Nunca engole erro: se a sessão
 *  não existe (dado órfão), se a reserva falhar, ou se a reserva não devolver id nenhum, joga o erro pra quem
 *  chamou — nunca cai de volta pro id recém-criado (isso deixaria uma segunda meeting sem uso, com custo e sem
 *  ninguém sabendo qual é a "oficial"). */
export async function garantirMeeting(sessaoId: string): Promise<string> {
  return (await meetingDaSessao(sessaoId)).id;
}

/** Igual a `garantirMeeting`, mais se a sala transcreve: só quando a meeting nasceu com a transcrição em português
 *  (`sessoes.rtk_transcreve`, gravado aqui na criação, se a agenda tinha `transcrever`) E a agenda continua com
 *  `transcrever` ligado. Meeting criada antes de ligar a chave não transcreve (sem `ai_config` sairia em inglês). */
export async function meetingDaSessao(sessaoId: string): Promise<{ id: string; transcreve: boolean }> {
  const db = dbAdmin();
  const { data: sessao } = await db.from("sessoes").select("rtk_meeting_id, rtk_transcreve, titulo, agenda_id").eq("id", sessaoId).maybeSingle();
  if (!sessao) throw new RegistroNaoEncontrado();
  const { data: agenda } = await db.from("agendas").select("nome, transcrever").eq("id", sessao.agenda_id).maybeSingle();
  const agendaTranscreve = agenda?.transcrever === true;
  if (sessao.rtk_meeting_id) return { id: sessao.rtk_meeting_id as string, transcreve: agendaTranscreve && sessao.rtk_transcreve === true };
  // Nunca grava sozinha pela meeting: quem começa a gravação é `passeEquipe` (agenda com `grava_sozinha`) ou o botão.
  const meeting = await criarMeeting({ titulo: (sessao.titulo as string | null) || agenda?.nome || "Call", transcrever: agendaTranscreve });
  const { data: id, error } = await db.rpc("reservar_meeting", { p_sessao: sessaoId, p_meeting: meeting.id });
  if (error) throw new Error("Não foi possível reservar a meeting.");
  if (!id) throw new RegistroNaoEncontrado();
  if (id !== meeting.id) {
    // Outra entrada criou a meeting antes: vale o que ela gravou.
    const { data: outra } = await db.from("sessoes").select("rtk_transcreve").eq("id", sessaoId).maybeSingle();
    return { id: id as string, transcreve: agendaTranscreve && outra?.rtk_transcreve === true };
  }
  if (!agendaTranscreve) return { id: id as string, transcreve: false };
  const { error: erroMarca } = await db.from("sessoes").update({ rtk_transcreve: true }).eq("id", sessaoId);
  if (erroMarca) {
    // Sem a marca, a sala segue sem transcrição (nunca impede a entrada).
    console.error("[sala] não marcou a transcrição da sessão", sessaoId, erroMarca.message);
    return { id: id as string, transcreve: false };
  }
  return { id: id as string, transcreve: true };
}

/** Passe do convidado: só devolve token quando a sala está `aberta`; garante uma presença por pessoa (expulsa
 *  antes de adicionar, pois a mesma pessoa pode ter aberto o link em outra aba/aparelho). */
export async function passeConvidado(codigo: string): Promise<{ passe?: Passe; estado: EstadoSala }> {
  const ctx = await contextoPorCodigo(codigo);
  if (!ctx) throw new RegistroNaoEncontrado();
  if (ctx.estado !== "aberta") return { estado: ctx.estado };
  const { id: meetingId, transcreve } = await meetingDaSessao(ctx.sessao.id);
  const p = await participanteUnico(meetingId, { nome: ctx.inscricao.nome, preset: presetDa("convidado", transcreve), customId: ctx.inscricao.id });
  return { passe: { token: p.token, nome: ctx.inscricao.nome, papel: "convidado", transcreve }, estado: ctx.estado };
}

/** Passe da equipe (anfitrião ou espião). Anfitrião abre a sala (status `ao_vivo` + `aberta_em`) se ainda não
 *  estiver aberta e fica registrado como anfitrião da sessão se for o primeiro (`anfitriao_id`); espião só entra como ouvinte invisível numa sala JÁ aberta (não pode iniciar sozinho uma sala
 *  gravada e cobrada). Ninguém entra depois de início + duração + 2h. Garante a meeting ANTES de marcar
 *  `ao_vivo`: se o RealtimeKit falhar, a sessão continua `agendada` — nunca fica "ao vivo" sem sala de verdade. */
export async function passeEquipe(sessaoId: string, membro: { id: string; nome: string }, modo: "anfitriao" | "espiao"): Promise<Passe> {
  const db = dbAdmin();
  const { data: sessao } = await db
    .from("sessoes")
    .select("id, status, inicio, rtk_meeting_id, agenda_id, agendas(duracao_min, grava_sozinha)")
    .eq("id", sessaoId)
    .maybeSingle();
  if (!sessao) throw new RegistroNaoEncontrado();
  if (sessao.status !== "agendada" && sessao.status !== "ao_vivo") throw new SessaoIndisponivel(sessao.status as string);
  if (modo === "espiao" && sessao.status !== "ao_vivo") throw new SessaoIndisponivel(sessao.status as string);
  const duracao = duracaoDaAgenda(sessao.agendas);
  if (sessao.inicio && duracao !== null && Date.now() >= prazoFinal(new Date(sessao.inicio as string), duracao).getTime()) {
    throw new SessaoIndisponivel(sessao.status as string);
  }
  const { id: meetingId, transcreve } = await meetingDaSessao(sessaoId);
  if (modo === "anfitriao" && sessao.status === "agendada") {
    const { error } = await db.from("sessoes").update({ status: "ao_vivo", aberta_em: new Date().toISOString() }).eq("id", sessaoId);
    if (error) throw new Error("Não foi possível abrir a sessão.");
    // Agenda que grava sozinha: começa a gravar pela API (vai pro R2 quando configurado), sem segurar a entrada.
    if (gravaSozinha(sessao.agendas)) {
      try {
        after(() => gravarAoAbrir({ tipo: "sessao", id: sessaoId }, meetingId));
      } catch (e) {
        console.error("[gravacao] não agendou a gravação", sessaoId, e instanceof Error ? e.message : "erro");
      }
    }
  }
  if (modo === "anfitriao") await registrarAnfitriao(db, sessaoId, membro.id);
  const p = await participanteUnico(meetingId, { nome: membro.nome, preset: presetDa(modo, transcreve), customId: `membro:${membro.id}` });
  return { token: p.token, nome: membro.nome, papel: modo, transcreve };
}

/** Guarda quem conduziu a sessão: o primeiro da equipe que entra como anfitrião (`marcar_anfitriao` só grava se ainda
 *  estiver vazio, então quem entra depois, ou volta, não sobrescreve). Falha só loga: nunca impede a entrada. */
async function registrarAnfitriao(db: ReturnType<typeof dbAdmin>, sessaoId: string, usuarioId: string): Promise<void> {
  try {
    const { error } = await db.rpc("marcar_anfitriao", { p_sessao: sessaoId, p_usuario: usuarioId });
    if (error) console.error("[sala] não registrou o anfitrião", sessaoId, error.message);
  } catch (e) {
    console.error("[sala] não registrou o anfitrião", sessaoId, e instanceof Error ? e.message : "erro");
  }
}

function gravaSozinha(agendas: unknown): boolean {
  const ag = (Array.isArray(agendas) ? agendas[0] : agendas) as { grava_sozinha?: boolean } | null | undefined;
  return ag?.grava_sozinha === true;
}

/** Encerra a sessão (só `agendada` ou `ao_vivo`): grava `encerrada` PRIMEIRO — quem pedir um passe nesse
 *  meio-tempo já vê a sessão acabada —, depois tira todo mundo da sala de verdade e desativa a meeting (tokens
 *  antigos param de funcionar). */
export async function encerrarSessao(sessaoId: string): Promise<void> {
  const db = dbAdmin();
  const { data: sessao } = await db.from("sessoes").select("status, rtk_meeting_id").eq("id", sessaoId).maybeSingle();
  if (!sessao) throw new RegistroNaoEncontrado();
  if (sessao.status !== "agendada" && sessao.status !== "ao_vivo") throw new SessaoIndisponivel(sessao.status as string);
  const { error } = await db.from("sessoes").update({ status: "encerrada" }).eq("id", sessaoId);
  if (error) throw new Error("Não foi possível encerrar a sessão.");
  if (sessao.rtk_meeting_id) await fecharMeeting(sessao.rtk_meeting_id as string);
}

/** Cron: fecha as sessões `ao_vivo` esquecidas (passaram de início + duração + 2h). Para cada uma grava
 *  `encerrada`, expulsa todos e desativa a meeting; erro numa sessão só é logado e não para as outras. Devolve
 *  quantas foram marcadas `encerrada`. */
export async function fecharSessoesVencidas(agora: Date = new Date()): Promise<number> {
  const db = dbAdmin();
  // Pré-filtro no banco (duração mínima de agenda é 15 min); a conta exata por duração é feita aqui.
  const limite = new Date(agora.getTime() - (15 + MARGEM_FECHAR_MIN) * 60_000).toISOString();
  const { data, error } = await db
    .from("sessoes")
    .select("id, inicio, rtk_meeting_id, agendas(duracao_min)")
    .eq("status", "ao_vivo")
    .lte("inicio", limite);
  if (error) throw new Error("Não foi possível listar as sessões ao vivo.");
  let fechadas = 0;
  for (const s of (data ?? []) as { id: string; inicio: string; rtk_meeting_id: string | null; agendas: unknown }[]) {
    const duracao = duracaoDaAgenda(s.agendas) ?? 0;
    if (agora.getTime() < prazoFinal(new Date(s.inicio), duracao).getTime()) continue;
    try {
      const { error: erroUpdate } = await db.from("sessoes").update({ status: "encerrada" }).eq("id", s.id).eq("status", "ao_vivo");
      if (erroUpdate) throw new Error("Não foi possível encerrar a sessão.");
      fechadas++;
      if (s.rtk_meeting_id) await fecharMeeting(s.rtk_meeting_id);
    } catch (e) {
      console.error("[sala] falha ao fechar sessão vencida", s.id, e instanceof Error ? e.message : e);
    }
  }
  return fechadas;
}

/** Status atual da sessão (ou `null` se não existe): a tela da equipe usa pra saber se foi expulsa porque a call
 *  acabou ou porque a mesma pessoa entrou em outra aba. */
export async function statusDaSessao(sessaoId: string): Promise<string | null> {
  const { data } = await dbAdmin().from("sessoes").select("status").eq("id", sessaoId).maybeSingle();
  return (data?.status as string | undefined) ?? null;
}
