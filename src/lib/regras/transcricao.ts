/** Transcrição ao vivo da call (etapa 2). Regras puras: servem à rota (validar o lote que a sala manda) e à aba
 *  "Alinhado" da coluna (juntar o que veio do servidor com o que chega ao vivo). */

export type Trecho = { id: string; nome: string; customId: string | null; texto: string; em: string };

export const MAX_TRECHOS_POR_LOTE = 100;
const MAX_ID = 100;
const MAX_NOME = 100;
const MAX_CUSTOM = 200;
const MAX_TEXTO = 2000;
/** Fala com data muito longe de agora é lixo (relógio errado ou dado forjado): até 12 h pra trás, 5 min pra frente. */
const PASSADO_MS = 12 * 3600_000;
const FUTURO_MS = 5 * 60_000;

function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

/** Data da fala: o SDK manda `date` (Date ou texto); a documentação fala em `timestamp` (ms). Aceita os dois. */
function dataDa(v: Record<string, unknown>): Date | null {
  const bruto = v.date ?? v.timestamp ?? v.em;
  const d = bruto instanceof Date ? bruto : typeof bruto === "number" || typeof bruto === "string" ? new Date(bruto) : null;
  return d && Number.isFinite(d.getTime()) ? d : null;
}

/** Uma fala do RealtimeKit (`TranscriptionData`) ou do lote → `Trecho`. Fala parcial ou sem texto = null. */
export function paraTrecho(v: unknown, agora: Date = new Date()): Trecho | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.isPartialTranscript === true) return null;
  const id = texto(o.id, MAX_ID);
  const nome = texto(o.name ?? o.nome, MAX_NOME) ?? "Sem nome";
  const fala = texto(o.transcript ?? o.texto, MAX_TEXTO);
  const d = dataDa(o);
  if (!id || !fala || !d) return null;
  const dif = d.getTime() - agora.getTime();
  if (dif > FUTURO_MS || dif < -PASSADO_MS) return null;
  const custom = texto(o.customParticipantId ?? o.customId, MAX_CUSTOM);
  return { id, nome, customId: custom, texto: fala, em: d.toISOString() };
}

/** Lote que a sala manda (`{ trechos: [...] }`) → falas válidas, sem repetir id. Lote que não é lista ou passa do
 *  limite = erro (a sala nunca manda mais de 100 de uma vez). */
export function lerLote(corpo: unknown, agora: Date = new Date()): { trechos?: Trecho[]; erro?: string } {
  const lista = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>).trechos : null;
  if (!Array.isArray(lista)) return { erro: "Mande { trechos: [...] }." };
  if (lista.length > MAX_TRECHOS_POR_LOTE) return { erro: `No máximo ${MAX_TRECHOS_POR_LOTE} trechos por envio.` };
  const vistos = new Set<string>();
  const trechos: Trecho[] = [];
  for (const item of lista) {
    const t = paraTrecho(item, agora);
    if (!t || vistos.has(t.id)) continue;
    vistos.add(t.id);
    trechos.push(t);
  }
  return { trechos };
}

/** Junta listas de falas (servidor + ao vivo) sem repetir id, em ordem de quando foram faladas. */
export function juntarTrechos(...listas: Trecho[][]): Trecho[] {
  const porId = new Map<string, Trecho>();
  for (const lista of listas) for (const t of lista) if (!porId.has(t.id)) porId.set(t.id, t);
  return [...porId.values()].sort((a, b) => a.em.localeCompare(b.em) || a.id.localeCompare(b.id));
}

/** Falas seguidas da mesma pessoa viram um bloco só (como a aba mostra): nome, hora da primeira fala e os textos. */
export function agruparPorFalante(trechos: Trecho[]): { nome: string; customId: string | null; em: string; textos: string[] }[] {
  const blocos: { nome: string; customId: string | null; em: string; textos: string[] }[] = [];
  for (const t of trechos) {
    const ultimo = blocos[blocos.length - 1];
    const mesma = ultimo && (t.customId ? ultimo.customId === t.customId : ultimo.nome === t.nome && !ultimo.customId);
    if (mesma) ultimo.textos.push(t.texto);
    else blocos.push({ nome: t.nome, customId: t.customId, em: t.em, textos: [t.texto] });
  }
  return blocos;
}

/** Transcrição corrida em texto ("[15:02] Ana: ..."), hora de Brasília. Base do resumo (etapa 3) e do .txt. */
export function transcricaoEmTexto(trechos: Trecho[]): string {
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return agruparPorFalante(trechos)
    .map((b) => `[${hora.format(new Date(b.em))}] ${b.nome}: ${b.textos.join(" ")}`)
    .join("\n");
}

/** Uma linha de CSV com campos entre aspas (aspas dobradas dentro do campo). */
function camposCsv(linha: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let dentro = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (dentro) {
      if (c === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (c === '"') dentro = false;
      else atual += c;
    } else if (c === '"') dentro = true;
    else if (c === ",") {
      campos.push(atual);
      atual = "";
    } else atual += c;
  }
  campos.push(atual);
  return campos;
}

/** Início da fala: ms desde o começo da call (número pequeno) ou data absoluta (epoch em ms ou texto ISO). */
function instante(v: unknown, base: Date): Date | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null;
  if (n !== null) return new Date(n < 1e11 ? base.getTime() + n : n);
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

/** Arquivo de transcrição da Cloudflare (webhook `meeting.transcript`, depois da call) → falas. Aceita o CSV (início
 *  ms, peerId, userId, customParticipantId, nome, texto; sem cabeçalho) e o JSON (`startTime`, `sentence`,
 *  `peerData`). `base`: início da sessão do RealtimeKit (`startedAt`), pros tempos relativos. Ids `cf:{sessão}:{n}`. */
export function lerTranscricaoCloudflare(arquivo: string, base: Date, rtkSessionId: string): Trecho[] {
  const brutos: { inicio: unknown; nome: unknown; customId: unknown; texto: unknown }[] = [];
  const t = arquivo.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    let json: unknown;
    try {
      json = JSON.parse(t);
    } catch {
      return [];
    }
    const lista = Array.isArray(json) ? json : ((json as Record<string, unknown>).transcript ?? (json as Record<string, unknown>).data);
    if (!Array.isArray(lista)) return [];
    for (const item of lista) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const peer = (o.peerData && typeof o.peerData === "object" ? o.peerData : {}) as Record<string, unknown>;
      brutos.push({
        inicio: o.startTime,
        nome: peer.displayName ?? peer.name ?? o.name,
        customId: peer.customParticipantId ?? peer.clientSpecificId ?? o.customParticipantId,
        texto: o.sentence ?? o.transcript,
      });
    }
  } else {
    for (const linha of t.split(/\r?\n/)) {
      if (!linha.trim()) continue;
      const c = camposCsv(linha);
      if (c.length < 6) continue;
      brutos.push({ inicio: c[0], nome: c[4], customId: c[3], texto: c.slice(5).join(",") });
    }
  }
  const trechos: Trecho[] = [];
  brutos.forEach((b, i) => {
    const em = instante(b.inicio, base);
    const fala = texto(b.texto, MAX_TEXTO);
    if (!em || !fala) return;
    trechos.push({
      id: `cf:${rtkSessionId}:${i}`.slice(0, MAX_ID),
      nome: texto(b.nome, MAX_NOME) ?? "Sem nome",
      customId: texto(b.customId, MAX_CUSTOM),
      texto: fala,
      em: em.toISOString(),
    });
  });
  return trechos;
}

