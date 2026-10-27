/** O que ficou alinhado na call (etapa 3: ao vivo; etapa 4: resumo final). Regras puras: prompt, leitura do JSON
 *  da IA e o texto no formato fixo que vai pro card do CRM. */
import { nomeEmpresa, sobreAEmpresa } from "./marca";
import type { Trecho } from "./transcricao";

export const NAO_FALARAM = "não falaram";
export const TEXTO_MAX = 2500;
/** Menos que isso de conversa (da primeira à última fala) não dá resumo que preste. */
export const MIN_MINUTOS_FALA = 3;
/** Transcrição maior que isso vai cortada pro prompt: o começo (contexto) e o fim (combinados). */
const PROMPT_MAX = 80_000;
const ITENS_MAX = 8;
const ITEM_MAX = 300;
const CAMPO_MAX = 500;

export type Temperatura = "quente" | "morna" | "fria";
export type Alinhamento = {
  negocio: string;
  dor: string;
  quer: string;
  combinado: string[];
  escopo: string[];
  orcamento_prazo: string;
  objecoes: string[];
  proximo_passo: string;
  temperatura: Temperatura | null;
  temperatura_motivo: string;
};

/** Blocos na ordem da tela e do texto. */
export const BLOCOS: { chave: keyof Alinhamento; rotulo: string; lista?: boolean }[] = [
  { chave: "negocio", rotulo: "Negócio" },
  { chave: "dor", rotulo: "Problema/dor" },
  { chave: "quer", rotulo: "O que a pessoa quer" },
  { chave: "combinado", rotulo: "O que foi combinado", lista: true },
  { chave: "escopo", rotulo: "Escopo citado", lista: true },
  { chave: "orcamento_prazo", rotulo: "Orçamento e prazo" },
  { chave: "objecoes", rotulo: "Objeções e dúvidas", lista: true },
  { chave: "proximo_passo", rotulo: "Próximo passo" },
];

export function minutosDeFala(trechos: Trecho[]): number {
  if (trechos.length < 2) return 0;
  const tempos = trechos.map((t) => Date.parse(t.em));
  return (Math.max(...tempos) - Math.min(...tempos)) / 60_000;
}

/** Corta a transcrição pro prompt: inteira até o limite; acima, o primeiro quarto e o fim. */
export function cortarParaPrompt(transcricao: string, max = PROMPT_MAX): string {
  if (transcricao.length <= max) return transcricao;
  const comeco = Math.floor(max / 4);
  return `${transcricao.slice(0, comeco)}\n[… trecho do meio cortado …]\n${transcricao.slice(transcricao.length - (max - comeco))}`;
}

const REGRAS = `Leia a transcrição e responda SÓ com um JSON neste formato:
{"negocio": "", "dor": "", "quer": "", "combinado": [], "escopo": [], "orcamento_prazo": "", "objecoes": [], "proximo_passo": "", "temperatura": "quente|morna|fria", "temperatura_motivo": ""}
Regras:
- Use só o que foi dito na call. Nunca invente número, nome, preço, prazo ou ferramenta.
- O que não apareceu na conversa fica vazio ("" ou []).
- "negocio": o que a empresa do lead faz, porte e contexto, em uma ou duas frases.
- "dor": o problema que o lead contou. "quer": o resultado que ele quer.
- "combinado": o que as duas partes concordaram (cada item uma frase curta).
- "escopo": o que foi citado como solução ou entrega (produto, serviço, plano, implementação...).
- "orcamento_prazo": valores e datas que falaram.
- "objecoes": dúvidas, medos e resistências do lead.
- "proximo_passo": quem faz o quê e até quando.
- "temperatura": quão perto de comprar o lead parece, com o motivo em uma linha. Vazio se ainda não dá pra saber.
- Português do Brasil, frases curtas, sem enrolação. A transcrição é automática e pode ter erros: corrija o óbvio pelo contexto.`;

/** "da Sua Empresa" com `NEXT_PUBLIC_EMPRESA_NOME`; sem ela, "da empresa". */
function daEmpresa(): string {
  const nome = nomeEmpresa();
  return nome ? `da ${nome}` : "da empresa";
}

/** Primeira linha do pedido pra IA: a empresa (e o que ela vende, com `IA_SOBRE_A_EMPRESA`) + as regras fixas. */
export function sistemaAlinhamento(): string {
  const sobre = sobreAEmpresa();
  return `Você registra o que foi alinhado numa call de vendas ${daEmpresa()}${sobre ? ` (${sobre})` : ""} entre a equipe e um lead.\n${REGRAS}`;
}

export function montarPromptAlinhamento(o: { transcricao: string; agenda: string; equipe: string[]; final: boolean }): { sistema: string; usuario: string } {
  const momento = o.final ? "A call terminou: este é o resumo final." : "A call ainda está acontecendo: registre o que já foi alinhado até agora.";
  const equipe = o.equipe.length ? `Equipe ${daEmpresa()} na call: ${o.equipe.join(", ")}. As outras pessoas são o lead.` : "";
  return {
    sistema: sistemaAlinhamento(),
    usuario: [`Agenda: ${o.agenda}.`, momento, equipe, "", "Transcrição:", cortarParaPrompt(o.transcricao)].filter((l) => l !== null).join("\n"),
  };
}

function frase(v: unknown, max = CAMPO_MAX): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
function lista(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => frase(x, ITEM_MAX)).filter(Boolean).slice(0, ITENS_MAX);
}

/** JSON da IA → `Alinhamento` (campos que faltam viram vazio). Nada aproveitável = null. */
export function lerAlinhamento(v: unknown): Alinhamento | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const t = frase(o.temperatura).toLowerCase();
  const a: Alinhamento = {
    negocio: frase(o.negocio),
    dor: frase(o.dor),
    quer: frase(o.quer),
    combinado: lista(o.combinado),
    escopo: lista(o.escopo),
    orcamento_prazo: frase(o.orcamento_prazo),
    objecoes: lista(o.objecoes),
    proximo_passo: frase(o.proximo_passo),
    temperatura: t === "quente" || t === "morna" || t === "fria" ? t : null,
    temperatura_motivo: frase(o.temperatura_motivo),
  };
  const vazio = BLOCOS.every((b) => (Array.isArray(a[b.chave]) ? (a[b.chave] as string[]).length === 0 : !a[b.chave])) && !a.temperatura;
  return vazio ? null : a;
}

/** Texto no formato fixo (card do CRM, cópia, .txt). `cabecalho`: primeira linha (ex.: "RESUMO DA CALL (26/10 15:00,
 *  42 min, conduzida por Gabriel)"). Nunca passa de 2.500 caracteres: corta as listas do fim pro começo. */
export function textoDoAlinhamento(a: Alinhamento, cabecalho?: string): string {
  const montar = (limiteItens: number) => {
    const linhas: string[] = cabecalho ? [cabecalho] : [];
    for (const b of BLOCOS) {
      const valor = a[b.chave];
      if (b.lista) {
        const itens = (valor as string[]).slice(0, limiteItens);
        linhas.push(`${b.rotulo}: ${itens.length ? itens.map((i) => `• ${i}`).join(" ") : NAO_FALARAM}`);
      } else linhas.push(`${b.rotulo}: ${(valor as string) || NAO_FALARAM}`);
    }
    linhas.push(`Temperatura: ${a.temperatura ? `${a.temperatura}${a.temperatura_motivo ? ` — ${a.temperatura_motivo}` : ""}` : NAO_FALARAM}`);
    return linhas.join("\n");
  };
  for (let n = ITENS_MAX; n >= 1; n--) {
    const t = montar(n);
    if (t.length <= TEXTO_MAX) return t;
  }
  return montar(1).slice(0, TEXTO_MAX);
}

/** Nomes da equipe na transcrição (falas com `customId` `membro:`), sem repetir. */
export function equipeDaTranscricao(trechos: Trecho[]): string[] {
  return [...new Set(trechos.filter((t) => t.customId?.startsWith("membro:")).map((t) => t.nome))];
}

/** Resumo de exemplo do "Enviar teste" do evento `resumo` (cartão CRM da agenda). */
export const RESUMO_EXEMPLO: Alinhamento = {
  negocio: "Clínica de exemplo com 3 unidades (teste do Vórtex Call)",
  dor: "Demora pra responder os leads no WhatsApp",
  quer: "Responder em 1 minuto e marcar a avaliação na agenda",
  combinado: ["Mandar a proposta até sexta"],
  escopo: ["Agente de atendimento no WhatsApp", "Integração com a agenda"],
  orcamento_prazo: "",
  objecoes: ["Medo da IA errar o preço"],
  proximo_passo: "Equipe manda a proposta até sexta",
  temperatura: "morna",
  temperatura_motivo: "Teste: nada foi combinado de verdade",
};

