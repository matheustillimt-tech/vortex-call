import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Alinhamento } from "../regras/alinhamento";
import { formatarDataHora } from "../regras/fuso";
import { paraE164 } from "../regras/telefone";
import { juntarTrechos, transcricaoEmTexto, type Trecho } from "../regras/transcricao";
import { ErroApi } from "./http";

const FUSO = "America/Sao_Paulo";
/** Transcrição devolvida junto (MCP/API) vai cortada aqui; o .txt do painel vai inteiro. */
export const TRANSCRICAO_MAX = 50_000;

/** Estado do resumo final: `sem_transcricao` (sessão não transcrita), `aguardando` (transcrita, ainda na fila ou
 *  esperando a call acabar) ou o `resumo_estado` da sessão (`pendente`, `pronto`, `sem_fala`, `falhou`). */
export type EstadoResumoCall = "sem_transcricao" | "aguardando" | "pendente" | "pronto" | "sem_fala" | "falhou";

export type ResumoCall = {
  sessao: { id: string; titulo: string | null; inicio: string; inicio_texto: string };
  estado: EstadoResumoCall;
  resumo: { texto: string; dados: Alinhamento; origem: "cloudflare" | "ao_vivo"; gerado_em: string } | null;
  transcricao?: string;
  transcricao_cortada?: boolean;
};

/** Falas da sessão: a transcrição da Cloudflare, senão as do ao vivo. */
export async function falasParaConsulta(db: SupabaseClient, sessaoId: string): Promise<Trecho[]> {
  const { data: cf, error } = await db.from("transcricoes").select("conteudo").eq("sessao_id", sessaoId);
  if (error) throw new Error("Não deu para ler a transcrição.");
  const listas = (cf ?? []).map((l) => (Array.isArray(l.conteudo) ? (l.conteudo as Trecho[]) : []));
  const daCloudflare = juntarTrechos(...listas);
  if (daCloudflare.length) return daCloudflare;
  const { data: vivo, error: e2 } = await db
    .from("transcricao_trechos")
    .select("rtk_id, falante_nome, custom_id, texto, falado_em")
    .eq("sessao_id", sessaoId)
    .order("falado_em", { ascending: true })
    .limit(5000);
  if (e2) throw new Error("Não deu para ler a transcrição.");
  return (vivo ?? []).map((l) => ({
    id: l.rtk_id as string, nome: l.falante_nome as string, customId: (l.custom_id as string | null) ?? null,
    texto: l.texto as string, em: new Date(l.falado_em as string).toISOString(),
  }));
}

/** Resumo final da call de uma sessão (e, com `comTranscricao`, a transcrição em texto, até 50 mil caracteres). */
export async function resumoDaSessao(db: SupabaseClient, sessaoId: string, o: { comTranscricao?: boolean } = {}): Promise<ResumoCall> {
  const { data: s, error } = await db.from("sessoes").select("id, titulo, inicio, rtk_transcreve, resumo_estado").eq("id", sessaoId).maybeSingle();
  if (error) throw new Error("Não deu para ler a sessão.");
  if (!s) throw new ErroApi(404, "Sessão não encontrada.");
  const { data: final, error: e2 } = await db
    .from("alinhamentos")
    .select("texto, dados, origem, gerado_em")
    .eq("sessao_id", sessaoId)
    .eq("tipo", "final")
    .maybeSingle();
  if (e2) throw new Error("Não deu para ler o resumo.");
  const estado: EstadoResumoCall = (s.resumo_estado as EstadoResumoCall | null) ?? (s.rtk_transcreve ? "aguardando" : "sem_transcricao");
  const r: ResumoCall = {
    sessao: { id: s.id as string, titulo: (s.titulo as string | null) ?? null, inicio: s.inicio as string, inicio_texto: formatarDataHora(new Date(s.inicio as string), FUSO) },
    estado,
    resumo: final ? (final as ResumoCall["resumo"]) : null,
  };
  if (o.comTranscricao && s.rtk_transcreve) {
    const texto = transcricaoEmTexto(await falasParaConsulta(db, sessaoId));
    r.transcricao = texto.slice(0, TRANSCRICAO_MAX);
    r.transcricao_cortada = texto.length > TRANSCRICAO_MAX;
  }
  return r;
}

/** Resumo da última call que o lead (WhatsApp) compareceu numa sessão transcrita. Sem nenhuma, 404. */
export async function resumoPorWhatsapp(db: SupabaseClient, whatsapp: string, o: { comTranscricao?: boolean } = {}): Promise<ResumoCall & { lead: string }> {
  const numero = paraE164(whatsapp);
  if (!numero) throw new ErroApi(422, "WhatsApp inválido.");
  const { data, error } = await db
    .from("inscricoes")
    .select("nome, sessao_id, sessoes(inicio, rtk_transcreve)")
    .eq("whatsapp", numero)
    .eq("status", "compareceu");
  if (error) throw new Error("Não deu para ler as inscrições.");
  const sessoes = ((data ?? []) as { nome: string; sessao_id: string; sessoes: unknown }[])
    .map((i) => ({ ...i, s: (Array.isArray(i.sessoes) ? i.sessoes[0] : i.sessoes) as { inicio: string; rtk_transcreve: boolean } | null }))
    .filter((i) => i.s?.rtk_transcreve)
    .sort((a, b) => b.s!.inicio.localeCompare(a.s!.inicio));
  const ultima = sessoes[0];
  if (!ultima) throw new ErroApi(404, "Esse WhatsApp não tem call transcrita.");
  return { lead: ultima.nome, ...(await resumoDaSessao(db, ultima.sessao_id, o)) };
}
