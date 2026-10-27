import "server-only";
import { iaConfig } from "./env";
import { completarJson } from "./openrouter";
import {
  equipeDaTranscricao, lerAlinhamento, minutosDeFala, montarPromptAlinhamento, textoDoAlinhamento, MIN_MINUTOS_FALA, type Alinhamento,
} from "./regras/alinhamento";
import { transcricaoEmTexto } from "./regras/transcricao";
import { dbAdmin } from "./supabase/admin";
import { listarTrechos } from "./transcricao";

/** Intervalo mínimo entre duas chamadas da IA pra mesma sessão (anfitrião e espião pedem a cada 2 min). */
const INTERVALO_MS = 90_000;

export type EstadoAlinhado =
  | { estado: "pronto"; dados: Alinhamento; gerado_em: string; falhou?: boolean }
  | { estado: "sem_fala" | "curto" | "sem_ia" | "falhou" };

type Linha = { dados: Alinhamento; total_trechos: number; gerado_em: string };

/** "Alinhado até agora" da sessão: devolve o último se for recente (menos de 90 s) ou se não entrou fala nova; senão
 *  pede à IA de novo com a transcrição inteira e guarda (`alinhamentos`, tipo `ao_vivo`). Com menos de 3 min de
 *  conversa não chama a IA. Se a IA falhar, devolve o último que deu certo (marcado `falhou`). `f`: fetch injetável. */
export async function alinhamentoAoVivo(sessaoId: string, agora: Date = new Date(), f: typeof fetch = fetch): Promise<EstadoAlinhado> {
  const db = dbAdmin();
  const { data: atual } = await db.from("alinhamentos").select("dados, total_trechos, gerado_em").eq("sessao_id", sessaoId).eq("tipo", "ao_vivo").maybeSingle();
  const anterior = atual as Linha | null;
  const pronto = (l: Linha, falhou = false): EstadoAlinhado => ({ estado: "pronto", dados: l.dados, gerado_em: l.gerado_em, ...(falhou ? { falhou } : {}) });
  if (anterior && agora.getTime() - Date.parse(anterior.gerado_em) < INTERVALO_MS) return pronto(anterior);

  const trechos = await listarTrechos(sessaoId);
  if (trechos.length === 0) return { estado: "sem_fala" };
  if (anterior && anterior.total_trechos === trechos.length) return pronto(anterior);
  if (minutosDeFala(trechos) < MIN_MINUTOS_FALA) return anterior ? pronto(anterior) : { estado: "curto" };
  const ia = iaConfig();
  if (!ia) return anterior ? pronto(anterior) : { estado: "sem_ia" };

  const { data: sessao } = await db.from("sessoes").select("titulo, agendas(nome)").eq("id", sessaoId).maybeSingle();
  const ag = sessao ? ((Array.isArray(sessao.agendas) ? sessao.agendas[0] : sessao.agendas) as { nome?: string } | null) : null;
  const pedido = montarPromptAlinhamento({
    transcricao: transcricaoEmTexto(trechos),
    agenda: (sessao?.titulo as string | null) || ag?.nome || "Call",
    equipe: equipeDaTranscricao(trechos),
    final: false,
  });
  let dados: Alinhamento | null = null;
  try {
    dados = lerAlinhamento(await completarJson({ ...pedido, maxTokens: 1200, temperatura: 0.2, prazoMs: 45_000 }, ia, f));
  } catch {
    dados = null;
  }
  if (!dados) return anterior ? pronto(anterior, true) : { estado: "falhou" };

  const linha = { dados, total_trechos: trechos.length, gerado_em: agora.toISOString() };
  const { error } = await db
    .from("alinhamentos")
    .upsert({ sessao_id: sessaoId, tipo: "ao_vivo", origem: "ao_vivo", texto: textoDoAlinhamento(dados), ...linha }, { onConflict: "sessao_id,tipo" });
  if (error) console.error("[alinhamento] gerado mas não salvo", sessaoId, error.message);
  return pronto(linha);
}
