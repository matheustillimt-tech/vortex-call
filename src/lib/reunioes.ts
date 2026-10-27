import "server-only";
import { createHash } from "node:crypto";
import { fecharMeeting, participanteUnico } from "./participantes";
import { criarMeeting } from "./realtimekit";
import { ehCodigoValido, gerarCodigo } from "./regras/codigo";
import { limparTitulo, situacaoReuniao, VALIDADE_REUNIAO_MS } from "./regras/reuniao";
import { RegistroNaoEncontrado, type Passe } from "./sala";
import { dbAdmin } from "./supabase/admin";

/** Reunião encerrada pela equipe, fechada pelo cron ou com as 24 h vencidas: ninguém entra mais (→ 409). */
export class ReuniaoEncerrada extends Error {
  constructor() {
    super("Essa reunião já terminou.");
  }
}

type Reuniao = { id: string; titulo: string; encerrada_em: string | null; expira_em: string; rtk_meeting_id: string | null };

async function reuniaoPorCodigo(codigo: string): Promise<Reuniao | null> {
  if (!ehCodigoValido(codigo)) return null;
  const { data } = await dbAdmin()
    .from("reunioes")
    .select("id, titulo, encerrada_em, expira_em, rtk_meeting_id")
    .eq("codigo", codigo)
    .maybeSingle();
  return (data as Reuniao | null) ?? null;
}

/** A reunião aberta (com a meeting) ou o erro tipado: inexistente → `RegistroNaoEncontrado`, encerrada/vencida →
 *  `ReuniaoEncerrada`. */
async function reuniaoAtiva(codigo: string): Promise<Reuniao & { rtk_meeting_id: string }> {
  const r = await reuniaoPorCodigo(codigo);
  if (!r) throw new RegistroNaoEncontrado();
  if (situacaoReuniao(r) !== "ativa") throw new ReuniaoEncerrada();
  if (!r.rtk_meeting_id) throw new Error("Reunião sem sala no RealtimeKit.");
  return r as Reuniao & { rtk_meeting_id: string };
}

/** Cria a reunião de quem está logado: a meeting no RealtimeKit já nasce aqui (sem gravar sozinha; o anfitrião
 *  grava pelo botão) e o link vale 24 h. Código repetido (chance mínima) tenta outro, reaproveitando a meeting. */
export async function criarReuniao(membro: { id: string }, titulo?: string): Promise<{ codigo: string }> {
  const t = limparTitulo(titulo);
  const meeting = await criarMeeting({ titulo: t });
  const db = dbAdmin();
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const codigo = gerarCodigo();
    const { error } = await db.from("reunioes").insert({
      codigo,
      titulo: t,
      criada_por: membro.id,
      rtk_meeting_id: meeting.id,
      expira_em: new Date(Date.now() + VALIDADE_REUNIAO_MS).toISOString(),
    });
    if (!error) return { codigo };
    if ((error as { code?: string }).code !== "23505") break;
  }
  throw new Error("Não foi possível criar a reunião.");
}

/** Leitura pública de `/r/{codigo}`: só o estado e o título (nada de quem criou, meeting ou datas). */
export async function estadoReuniao(codigo: string): Promise<null | { estado: "ativa" | "encerrada"; titulo: string }> {
  const r = await reuniaoPorCodigo(codigo);
  if (!r) return null;
  return { estado: situacaoReuniao(r) === "ativa" ? "ativa" : "encerrada", titulo: r.titulo };
}

/** Id da reunião pelo código (só pra página do membro logado: é o alvo do botão Gravar). */
export async function idDaReuniao(codigo: string): Promise<string | null> {
  const r = await reuniaoPorCodigo(codigo);
  return r?.id ?? null;
}

/** Membro logado (qualquer papel) entra como anfitrião, com o nome do cadastro. */
export async function passeReuniaoMembro(codigo: string, membro: { id: string; nome: string }): Promise<Passe> {
  const r = await reuniaoAtiva(codigo);
  const p = await participanteUnico(r.rtk_meeting_id, { nome: membro.nome, preset: "vortex_anfitriao", customId: `membro:${membro.id}` });
  return { token: p.token, nome: membro.nome, papel: "anfitriao" };
}

/** Pessoa de fora: entra direto (sem sala de espera) como participante. `nome` já limpo e `visitanteId` já validado
 *  pela rota. Uma presença por navegador (o id fica no `localStorage` por reunião). O `customId` leva só o sha256
 *  do id (32 primeiros hex): o id é o segredo do navegador e o customId fica visível pros outros na sala. */
export async function passeReuniaoVisitante(codigo: string, nome: string, visitanteId: string): Promise<Passe> {
  const r = await reuniaoAtiva(codigo);
  const p = await participanteUnico(r.rtk_meeting_id, { nome, preset: "vortex_participante", customId: `visitante:${createHash("sha256").update(visitanteId).digest("hex").slice(0, 32)}` });
  return { token: p.token, nome, papel: "participante" };
}

/** Qualquer membro encerra. Grava `encerrada_em` PRIMEIRO (quem pedir passe nesse meio-tempo já vê a reunião
 *  acabada), depois tira todo mundo e desativa a meeting — mesma ordem de `encerrarSessao`. `membro` fica na
 *  assinatura porque só a equipe encerra (quem chama já conferiu o login). */
export async function encerrarReuniao(codigo: string, membro: { id: string }): Promise<void> {
  void membro;
  const r = await reuniaoAtiva(codigo);
  const { error } = await dbAdmin().from("reunioes").update({ encerrada_em: new Date().toISOString() }).eq("id", r.id).is("encerrada_em", null);
  if (error) throw new Error("Não foi possível encerrar a reunião.");
  await fecharMeeting(r.rtk_meeting_id);
}

/** Cron: fecha as reuniões abertas que passaram das 24 h (marca `encerrada_em`, expulsa todos, desativa a meeting).
 *  Erro numa só é logado e não para as outras. Devolve quantas foram marcadas. */
export async function fecharReunioesVencidas(agora: Date = new Date()): Promise<number> {
  const db = dbAdmin();
  const { data, error } = await db
    .from("reunioes")
    .select("id, rtk_meeting_id")
    .is("encerrada_em", null)
    .lte("expira_em", agora.toISOString());
  if (error) throw new Error("Não foi possível listar as reuniões vencidas.");
  let fechadas = 0;
  for (const r of (data ?? []) as { id: string; rtk_meeting_id: string | null }[]) {
    try {
      const { error: erroUpdate } = await db.from("reunioes").update({ encerrada_em: agora.toISOString() }).eq("id", r.id).is("encerrada_em", null);
      if (erroUpdate) throw new Error("Não foi possível encerrar a reunião.");
      fechadas++;
      if (r.rtk_meeting_id) await fecharMeeting(r.rtk_meeting_id);
    } catch (e) {
      console.error("[reuniao] falha ao fechar reunião vencida", r.id, e instanceof Error ? e.message : e);
    }
  }
  return fechadas;
}
