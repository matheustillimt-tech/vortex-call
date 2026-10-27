import "server-only";
import { createHash } from "node:crypto";
import { participanteUnico } from "./participantes";
import { ehConviteValido, gerarConvite, situacaoConvite, type SituacaoConvite } from "./regras/convite";
import { duracaoDaAgenda } from "./regras/estado-sala";
import { presetDa } from "./regras/presets";
import { meetingDaSessao, RegistroNaoEncontrado, SessaoIndisponivel, type Passe } from "./sala";
import { dbAdmin } from "./supabase/admin";

/** Link de convidado da sessão (`/s/{codigo}`): o anfitrião copia na sala e manda pra um sócio ou parceiro, que
 *  entra na hora como participante (fala, câmera, tela), sem login, sem inscrição e sem contar vaga. Nunca vira
 *  lead: o `customId` dele é `convidado:<hash>`, que a presença, a atividade, o CRM e a ficha ignoram. */

/** O convidado tentou entrar fora da hora: sala ainda não aberta pelo anfitrião ou call já terminada (→ 409). */
export class ConviteIndisponivel extends Error {
  constructor(public estado: Exclude<SituacaoConvite, "aberta">) {
    super("A sala não está aberta.");
  }
}

type SessaoConvite = { id: string; status: string; inicio: string; titulo: string | null; rtk_meeting_id: string | null; agendas: unknown };

async function lerSessao(sessaoId: string): Promise<SessaoConvite | null> {
  const { data } = await dbAdmin()
    .from("sessoes")
    .select("id, status, inicio, titulo, rtk_meeting_id, agendas(nome, duracao_min)")
    .eq("id", sessaoId)
    .maybeSingle();
  return (data as SessaoConvite | null) ?? null;
}

function situacao(s: SessaoConvite): SituacaoConvite {
  return situacaoConvite({ status: s.status, inicio: new Date(s.inicio), duracaoMin: duracaoDaAgenda(s.agendas), agora: new Date() });
}

function nomeDaAgenda(agendas: unknown): string | null {
  const a = (Array.isArray(agendas) ? agendas[0] : agendas) as { nome?: string } | null | undefined;
  return a?.nome ?? null;
}

async function codigoDaSessao(sessaoId: string): Promise<string | null> {
  const { data } = await dbAdmin().from("convites_sessao").select("codigo").eq("sessao_id", sessaoId).maybeSingle();
  return (data?.codigo as string | undefined) ?? null;
}

/** Código do link de convidado da sessão, criado no primeiro pedido (depois é sempre o mesmo). Quem chama já
 *  conferiu que a pessoa é anfitriã desta sessão. Sessão encerrada, cancelada ou vencida não ganha link
 *  (`SessaoIndisponivel`). Dois cliques ao mesmo tempo: o segundo insert bate na chave (`23505`) e lê o do primeiro. */
export async function codigoDoConvite(sessaoId: string, criadoPor: string): Promise<string> {
  const sessao = await lerSessao(sessaoId);
  if (!sessao) throw new RegistroNaoEncontrado();
  if (situacao(sessao) === "encerrada") throw new SessaoIndisponivel(sessao.status);
  const existente = await codigoDaSessao(sessaoId);
  if (existente) return existente;
  const db = dbAdmin();
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const codigo = gerarConvite();
    const { error } = await db.from("convites_sessao").insert({ sessao_id: sessaoId, codigo, criado_por: criadoPor });
    if (!error) return codigo;
    if ((error as { code?: string }).code !== "23505") break;
    const outro = await codigoDaSessao(sessaoId);
    if (outro) return outro;
  }
  throw new Error("Não foi possível criar o link de convidado.");
}

async function sessaoDoConvite(codigo: string): Promise<SessaoConvite | null> {
  if (!ehConviteValido(codigo)) return null;
  const { data } = await dbAdmin().from("convites_sessao").select("sessao_id").eq("codigo", codigo).maybeSingle();
  if (!data) return null;
  return lerSessao(data.sessao_id as string);
}

/** Leitura pública de `/s/{codigo}`: só o estado e o nome da call (nada de inscritos, meeting ou datas). */
export async function estadoConvite(codigo: string): Promise<null | { estado: SituacaoConvite; titulo: string }> {
  const s = await sessaoDoConvite(codigo);
  if (!s) return null;
  return { estado: situacao(s), titulo: s.titulo || nomeDaAgenda(s.agendas) || "Call" };
}

/** `customId` do convidado de fora: prefixo `convidado:` + sha256 (32 hex) do id do navegador. O id é o segredo do
 *  navegador e o customId fica visível pros outros na sala, então só vai o hash (igual à reunião instantânea). */
export function customIdConvidado(visitanteId: string): string {
  return `convidado:${createHash("sha256").update(visitanteId).digest("hex").slice(0, 32)}`;
}

/** Passe do convidado de fora: só com a sessão ao vivo, preset `vortex_participante` (ou o `_transcricao`), uma presença por navegador.
 *  Não confere vagas e não grava nada no banco de leads (inscrição, evento, presença). `nome` já limpo e
 *  `visitanteId` já validado pela rota. */
export async function passeConvite(codigo: string, nome: string, visitanteId: string): Promise<Passe> {
  const s = await sessaoDoConvite(codigo);
  if (!s) throw new RegistroNaoEncontrado();
  const estado = situacao(s);
  if (estado !== "aberta") throw new ConviteIndisponivel(estado);
  const { id: meetingId, transcreve } = await meetingDaSessao(s.id);
  const p = await participanteUnico(meetingId, { nome, preset: presetDa("participante", transcreve), customId: customIdConvidado(visitanteId) });
  return { token: p.token, nome, papel: "participante", transcreve };
}
