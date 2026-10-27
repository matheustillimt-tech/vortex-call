import { DateTime } from "luxon";
import { minutosDePresenca } from "./presenca-minutos";
import { NOTA_INTERAGIU, notaInteracao } from "./interacao";

/** Regras puras do dashboard (Início e painel da sessão): filtros da URL, períodos em Brasília, formatação e
 *  geometria dos gráficos em SVG. Os componentes só desenham o que sai daqui. */

const FUSO = "America/Sao_Paulo";
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

export const PERIODOS_DASHBOARD = ["hoje", "7d", "30d", "90d", "personalizado"] as const;
export type PeriodoDashboard = (typeof PERIODOS_DASHBOARD)[number];
export const ROTULO_PERIODO: Record<PeriodoDashboard, string> = {
  hoje: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  personalizado: "Personalizado",
};
const PERIODO_PADRAO: PeriodoDashboard = "30d";
const DIAS: Record<"7d" | "30d" | "90d", number> = { "7d": 7, "30d": 30, "90d": 90 };

export type FiltrosDashboard = {
  periodo: PeriodoDashboard;
  /** `YYYY-MM-DD` (só no personalizado). */
  de: string | null;
  ate: string | null;
  agenda: string | null;
  sessao: string | null;
  /** Vendedor (usuário) — só o admin usa; pro membro o recorte já é feito no banco. */
  vendedor: string | null;
};

const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);
const uuid = (v: unknown): string | null => {
  const t = texto(v);
  return t && RE_UUID.test(t) ? t.toLowerCase() : null;
};
const dia = (v: unknown): string | null => {
  const t = texto(v);
  return t && RE_DIA.test(t) && DateTime.fromISO(t, { zone: FUSO }).isValid ? t : null;
};

/** Query string (`?periodo=&de=&ate=&agenda=&sessao=&vendedor=`) → filtros válidos. Lixo vira o padrão (30 dias, sem filtro);
 *  personalizado sem data de início válida também cai em 30 dias. */
export function filtrosDashboardDe(q: Record<string, string | string[] | undefined>): FiltrosDashboard {
  const p = texto(q.periodo);
  let periodo: PeriodoDashboard = p && (PERIODOS_DASHBOARD as readonly string[]).includes(p) ? (p as PeriodoDashboard) : PERIODO_PADRAO;
  let de: string | null = null;
  let ate: string | null = null;
  if (periodo === "personalizado") {
    de = dia(q.de);
    ate = dia(q.ate);
    if (!de) {
      periodo = PERIODO_PADRAO;
      ate = null;
    }
  }
  return { periodo, de, ate, agenda: uuid(q.agenda), sessao: uuid(q.sessao), vendedor: uuid(q.vendedor) };
}

/** Filtros → query string (vazia no padrão). Mesma ordem sempre, pra URL estável. */
export function queryDosFiltros(f: FiltrosDashboard): string {
  const q = new URLSearchParams();
  if (f.periodo !== PERIODO_PADRAO) q.set("periodo", f.periodo);
  if (f.periodo === "personalizado") {
    if (f.de) q.set("de", f.de);
    if (f.ate) q.set("ate", f.ate);
  }
  if (f.agenda) q.set("agenda", f.agenda);
  if (f.sessao) q.set("sessao", f.sessao);
  if (f.vendedor) q.set("vendedor", f.vendedor);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Intervalo `[de, ate)` em UTC das sessões do período, com os dias contados em Brasília. "7 dias" = hoje e os 6
 *  anteriores (até a meia-noite de amanhã). Personalizado: do início do dia `de` ao fim do dia `ate` (sem `ate`,
 *  até o fim de hoje); datas trocadas são invertidas. */
export function intervaloDoPeriodo(f: FiltrosDashboard, agora: Date): { de: Date; ate: Date } {
  const hoje = DateTime.fromJSDate(agora, { zone: FUSO }).startOf("day");
  const amanha = hoje.plus({ days: 1 });
  if (f.periodo === "hoje") return { de: hoje.toJSDate(), ate: amanha.toJSDate() };
  if (f.periodo === "personalizado" && f.de) {
    let ini = DateTime.fromISO(f.de, { zone: FUSO }).startOf("day");
    let fim = f.ate ? DateTime.fromISO(f.ate, { zone: FUSO }).startOf("day") : hoje;
    if (fim < ini) [ini, fim] = [fim, ini];
    return { de: ini.toJSDate(), ate: fim.plus({ days: 1 }).toJSDate() };
  }
  const n = DIAS[f.periodo as keyof typeof DIAS] ?? DIAS["30d"];
  return { de: hoje.minus({ days: n - 1 }).toJSDate(), ate: amanha.toJSDate() };
}

/* ------------------------------------------------------------------ formatação */

/** Centavos → "R$ 1.234,56" (sem depender do ICU do servidor). */
export function formatarReais(centavos: number): string {
  const c = Math.round(Math.max(0, Number(centavos) || 0));
  const reais = Math.floor(c / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${reais},${String(c % 100).padStart(2, "0")}`;
}

/** `parte ÷ total` em %: inteiro, com uma casa abaixo de 10%; "—" quando não há base. Nunca passa de 100% (a parte
 *  sempre é um subconjunto do total; se um dado inconsistente vier maior, trava em 100%). */
export function formatarPercentual(parte: number, total: number): string {
  if (!(total > 0)) return "—";
  const p = (Math.min(parte, total) / total) * 100;
  if (p > 0 && p < 10) return `${p.toFixed(1).replace(".", ",")}%`;
  return `${Math.round(p)}%`;
}

/** Número com até 1 casa, vírgula decimal ("12,5", "40"). */
export function formatarDecimal(n: number): string {
  const r = Math.round((Number(n) || 0) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",");
}

export function formatarMinutosMedios(min: number): string {
  return Number(min) > 0 ? `${formatarDecimal(min)} min` : "—";
}

/** Antecedência média do anfitrião (minutos antes do início em que entrou): "5 min antes", "na hora", "3 min atrasado";
 *  "—" sem dado (não conduziu nenhuma sessão no filtro). */
export function formatarAntecedencia(min: number | null): string {
  if (min === null || !Number.isFinite(Number(min))) return "—";
  const r = Math.round(Number(min) * 10) / 10;
  if (r === 0) return "na hora";
  return r > 0 ? `${formatarDecimal(r)} min antes` : `${formatarDecimal(-r)} min atrasado`;
}

/** Indicadores da linha do vendedor: comparecimento (vieram ÷ inscritos), conversão (compraram ÷ vieram) e ticket
 *  médio (receita ÷ compraram); "—" quando a base é 0, como no resto do dashboard. */
export function indicadoresVendedor(v: { inscritos: number; vieram: number; compraram: number; receita_centavos: number }): {
  comparecimento: string;
  conversao: string;
  ticket: string;
} {
  return {
    comparecimento: formatarPercentual(v.vieram, v.inscritos),
    conversao: formatarPercentual(v.compraram, v.vieram),
    ticket: v.compraram > 0 ? formatarReais(v.receita_centavos / v.compraram) : "—",
  };
}

export type CorNota = "erro" | "aviso" | "ok";
/** Faixas da nota de interação: abaixo de 30 (não interagiu) vermelho, 30 a 60 âmbar, acima de 60 verde. */
export function corDaNota(nota: number): CorNota {
  if (nota < NOTA_INTERAGIU) return "erro";
  return nota > 60 ? "ok" : "aviso";
}

/* ------------------------------------------------------------------ funil */

export type ResumoFunil = { inscritos: number; vieram: number; ficaram_ate_fim: number; interagiram: number; compraram: number };
/** `percentual` + `sobre` formam o texto ("40%" "dos inscritos"); a primeira etapa (Inscritos) não tem. */
export type EtapaFunil = { chave: keyof ResumoFunil; rotulo: string; valor: number; percentual: string | null; sobre: string | null };

const ETAPAS: { chave: keyof ResumoFunil; rotulo: string }[] = [
  { chave: "inscritos", rotulo: "Inscritos" },
  { chave: "vieram", rotulo: "Vieram" },
  { chave: "interagiram", rotulo: "Interagiram" },
  { chave: "compraram", rotulo: "Compraram" },
];

/** Etapas do funil com o %. Vieram é sobre os inscritos; as etapas depois (interagiram, compraram) são sobre quem
 *  veio, porque não são aninhadas (dá pra comprar sem interagir) e o % sobre a anterior passaria de 100%.
 *  "Ficaram até o fim" não entra no funil; o número segue no Resumo. */
export function etapasFunil(r: ResumoFunil): EtapaFunil[] {
  const inscritos = Number(r.inscritos) || 0;
  const vieram = Number(r.vieram) || 0;
  return ETAPAS.map((e, i) => {
    const valor = Number(r[e.chave]) || 0;
    if (i === 0) return { ...e, valor, percentual: null, sobre: null };
    if (i === 1) return { ...e, valor, percentual: formatarPercentual(valor, inscritos), sobre: "dos inscritos" };
    return { ...e, valor, percentual: formatarPercentual(valor, vieram), sobre: "de quem veio" };
  });
}

/* ------------------------------------------------------------------ escalas e geometria */

/** Marcas do eixo Y de 0 até um máximo "redondo" (passo 1, 2, 5 × 10ⁿ, cerca de 5 marcas; nunca menor que 1, porque
 *  os eixos contam pessoas). */
export function marcasEixo(maximo: number, alvo = 5): number[] {
  const max = Math.max(0, Number(maximo) || 0);
  if (max === 0) return [0, 1];
  const bruto = max / alvo;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((p) => p >= bruto) ?? 10 * mag);
  const topo = Math.ceil(max / passo) * passo;
  const marcas: number[] = [];
  for (let v = 0; v <= topo + passo / 2; v += passo) marcas.push(Math.round(v * 1e6) / 1e6);
  return marcas;
}

/** Barras agrupadas: `grupos` bandas iguais em `largura`, cada uma com `folga` (fração) de respiro dividida nos dois
 *  lados e `series` barras lado a lado. */
export function barrasAgrupadas(o: { grupos: number; series: number; largura: number; folga?: number }): {
  centro: number;
  barras: { x: number; largura: number }[];
}[] {
  if (o.grupos <= 0 || o.series <= 0) return [];
  const banda = o.largura / o.grupos;
  const folga = o.folga ?? 0.3;
  const util = banda * (1 - folga);
  const larg = util / o.series;
  return Array.from({ length: o.grupos }, (_, g) => {
    const ini = g * banda + (banda - util) / 2;
    return {
      centro: g * banda + banda / 2,
      barras: Array.from({ length: o.series }, (_, s) => ({ x: arred(ini + s * larg), largura: arred(larg) })),
    };
  });
}

const arred = (n: number) => Math.round(n * 100) / 100;

/** Pontos → `d` de um `<path>` (M x,y L x,y …), 2 casas. */
export function caminhoLinha(pontos: { x: number; y: number }[]): string {
  return pontos.map((p, i) => `${i === 0 ? "M" : "L"}${arred(p.x)},${arred(p.y)}`).join(" ");
}

/** Duração da agenda a partir da série de `dashboard_retencao`, que vai do minuto 0 até duração + 30. */
export function duracaoDaRetencao(pontos: { minuto: number }[]): number | null {
  if (pontos.length === 0) return null;
  return Math.max(0, Math.max(...pontos.map((p) => p.minuto)) - 30);
}

/* ------------------------------------------------------------------ sessões dos gráficos */

/** As `n` sessões mais recentes, em ordem cronológica (pros gráficos por sessão). */
export function ultimasSessoesCronologicas<T extends { inicio: string }>(sessoes: T[], n: number): T[] {
  return [...sessoes].sort((a, b) => Date.parse(b.inicio) - Date.parse(a.inicio)).slice(0, n).reverse();
}

/** Sessão da linha de retenção: a do filtro; senão a mais recente com alguém que veio. */
export function sessaoDaRetencao(sessoes: { id: string; inicio: string; vieram: number }[], filtro: string | null): string | null {
  if (filtro) return filtro;
  const comPublico = sessoes.filter((s) => s.vieram > 0).sort((a, b) => Date.parse(b.inicio) - Date.parse(a.inicio));
  return comPublico[0]?.id ?? null;
}

/* ------------------------------------------------------------------ por lead */

/** Minutos do lead na sessão, com a mesma regra de `dashboard_linhas` (SQL): presenças unidas, cortadas no início da
 *  sessão e no fim da janela (início + duração + 2 h, ou agora se for antes); sem presença nenhuma, vale o
 *  `minutos_na_sala` gravado (ex.: marcado à mão). */
export function minutosDoLead(o: {
  presencas: { entrou_em: string; saiu_em: string | null }[];
  inicio: Date;
  duracaoMin: number;
  agora: Date;
  minutosNaSala: number | null;
}): number {
  if (o.presencas.length === 0) return o.minutosNaSala ?? 0;
  const fim = new Date(Math.min(o.inicio.getTime() + (o.duracaoMin + 120) * 60_000, o.agora.getTime()));
  const ini = o.inicio.getTime();
  return minutosDePresenca(
    o.presencas.map((p) => ({ entrou: new Date(Math.max(Date.parse(p.entrou_em), ini)), saiu: p.saiu_em ? new Date(p.saiu_em) : null })),
    fim,
  );
}

/** Um lead na tela da sessão (detalhe e painel), com a regra de `dashboard_linhas`: veio = não cancelado e
 *  (compareceu OU tem presença); minutos por `minutosDoLead`; nota só pra quem veio (`null` = a tela mostra "—"). */
export function leadNaSessao(o: {
  status: string;
  presencas: { entrou_em: string; saiu_em: string | null }[];
  inicio: Date;
  duracaoMin: number;
  agora: Date;
  minutosNaSala: number | null;
  atividade: { mic_s: number; cam_s: number; msgs: number } | undefined;
}): { veio: boolean; minutos: number; nota: number | null } {
  const veio = o.status !== "cancelado" && (o.status === "compareceu" || o.presencas.length > 0);
  if (!veio) return { veio, minutos: 0, nota: null };
  const minutos = minutosDoLead(o);
  const a = o.atividade;
  return { veio, minutos, nota: notaInteracao({ minutos, duracaoMin: o.duracaoMin, msgs: a?.msgs ?? 0, micS: a?.mic_s ?? 0, camS: a?.cam_s ?? 0 }) };
}

/** Intervalo `[de, ate)` → dias inclusivos `YYYY-MM-DD` em Brasília (pra preencher os campos do personalizado). */
export function diasDoIntervalo(i: { de: Date; ate: Date }): { de: string; ate: string } {
  return {
    de: DateTime.fromJSDate(i.de, { zone: FUSO }).toFormat("yyyy-MM-dd"),
    ate: DateTime.fromJSDate(new Date(i.ate.getTime() - 1), { zone: FUSO }).toFormat("yyyy-MM-dd"),
  };
}

/** Rótulo curto da sessão nos eixos e no seletor: "22/10 19:00" (Brasília). */
export function rotuloCurtoSessao(inicio: string): string {
  return DateTime.fromISO(inicio, { zone: FUSO }).toFormat("dd/MM HH:mm");
}
