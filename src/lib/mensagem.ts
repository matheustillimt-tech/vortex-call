import "server-only";
import { completarJson, type CfgOpenRouter } from "./openrouter";
import type { NomeEvento } from "./regras/eventos-nomes";
import { respostasDoFormulario } from "./regras/ficha";
import {
  contextoDaFicha,
  extrairMensagem,
  linksObrigatorios,
  mensagemPadrao,
  montarPromptMensagem,
  type DadosMensagem,
} from "./regras/mensagem";
import type { Db } from "./ficha";

/** Tempo máximo da IA por mensagem (somando os modelos de reserva). Cabe no lote do cron: a entrega começa POST
 *  novo até 40 s, e quem chama ainda encurta esse tempo pra não passar do prazo. */
export const TEMPO_IA_MS = 8_000;
/** Menos que isso não dá pra IA responder: vai direto o texto fixo. */
const TEMPO_MINIMO_IA_MS = 1_500;

/** Mensagem de WhatsApp pronta pro evento. Escrita pela IA quando ela está configurada e responde a tempo com um
 *  texto válido (links exatos, até 600 caracteres); em qualquer outro caso, o texto fixo de `mensagemPadrao`.
 *  "Compareceu" → vazio, sem chamar a IA. Nunca lança: a entrega não pode parar por causa da IA. */
export async function gerarMensagem(o: {
  evento: NomeEvento;
  dados: DadosMensagem;
  contexto: string | null;
  ia: CfgOpenRouter | null;
  tempoMs?: number;
  f?: typeof fetch;
}): Promise<string> {
  if (o.evento === "compareceu") return "";
  const padrao = mensagemPadrao(o.evento, o.dados);
  const tempo = Math.min(o.tempoMs ?? TEMPO_IA_MS, TEMPO_IA_MS);
  if (!o.ia || tempo < TEMPO_MINIMO_IA_MS) return padrao;
  try {
    const pedido = { ...montarPromptMensagem(o.evento, o.dados, o.contexto), maxTokens: 300, temperatura: 0.7, prazoMs: tempo };
    const resposta = await completarJson(pedido, o.ia, o.f ?? fetch);
    const texto = extrairMensagem(resposta, linksObrigatorios(o.evento, o.dados));
    if (texto) return texto;
    console.warn("[crm] mensagem da IA recusada na validação", o.evento);
  } catch {
    console.warn("[crm] IA não respondeu, vai o texto fixo", o.evento);
  }
  return padrao;
}

/** Contexto curto da ficha do lead (resumo da IA já gerado, senão poucas respostas do formulário) pra IA
 *  dar um toque pessoal. Qualquer erro ou falta de dado → `null` (a mensagem sai sem ele). */
export async function contextoDoLead(db: Db, inscricaoId: string): Promise<string | null> {
  try {
    const { data: insc } = await db.from("inscricoes").select("whatsapp, respostas").eq("id", inscricaoId).maybeSingle();
    const i = insc as { whatsapp?: string; respostas?: unknown } | null;
    if (!i?.whatsapp) return null;
    const { data: ficha } = await db.from("fichas").select("resumo_ia").eq("whatsapp", i.whatsapp).maybeSingle();
    const resumo = (ficha as { resumo_ia?: string | null } | null)?.resumo_ia ?? null;
    return contextoDaFicha(resumo, respostasDoFormulario(i.respostas));
  } catch {
    return null;
  }
}
