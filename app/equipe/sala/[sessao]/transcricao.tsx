"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRealtimeKitMeeting } from "@cloudflare/realtimekit-react";
import { agruparPorFalante, juntarTrechos, MAX_TRECHOS_POR_LOTE, paraTrecho, type Trecho } from "@/src/lib/regras/transcricao";
import { BLOCOS, NAO_FALARAM, textoDoAlinhamento, type Alinhamento } from "@/src/lib/regras/alinhamento";
import type { EstadoAlinhado } from "@/src/lib/alinhamento";

const ENVIO_MS = 15_000;
const BUSCA_MS = 15_000;
const ALINHADO_MS = 120_000;
/** Teto da fila de envio (internet caída por muito tempo): as mais antigas saem primeiro. */
const FILA_MAX = 1000;

type Parcial = { nome: string; texto: string };

/**
 * Transcrição ao vivo na sala da equipe. Escuta as falas do RealtimeKit (`meeting.ai`, evento `transcript`):
 * - `enviar` (anfitrião de sessão transcrita): manda as falas finais em lotes de 15 s pra
 *   `POST /api/sala/transcricao/{sessao}` (e o que sobrou ao fechar a aba, com `keepalive`). 409 = a sessão não
 *   transcreve mais: para de mandar.
 * - `ver` (permissão `transcricao`): busca as falas gravadas (de 15 em 15 s) e junta com as que chegam ao vivo; o
 *   espião, que não é transcrito, também vê por aqui. E pede o "Alinhado até agora" a cada 2 min
 *   (`POST /api/sala/alinhado/{sessao}`; o servidor só chama a IA quando entrou fala nova).
 */
export function useTranscricao({ sessaoId, enviar, ver }: { sessaoId: string; enviar: boolean; ver: boolean }) {
  const { meeting } = useRealtimeKitMeeting();
  const [aoVivo, setAoVivo] = useState<Trecho[]>([]);
  const [doServidor, setDoServidor] = useState<Trecho[]>([]);
  const [parciais, setParciais] = useState<Record<string, Parcial>>({});
  const fila = useRef<Trecho[]>([]);
  const parado = useRef(false);

  useEffect(() => {
    if (!enviar && !ver) return;
    const ai = (meeting as unknown as { ai?: { on: (e: string, f: (t: unknown) => void) => void; off: (e: string, f: (t: unknown) => void) => void } }).ai;
    if (!ai) return;
    const aoFalar = (bruto: unknown) => {
      const t = bruto as { peerId?: string; name?: string; transcript?: string; isPartialTranscript?: boolean };
      const chave = t.peerId ?? t.name ?? "?";
      if (t.isPartialTranscript) {
        if (ver && t.transcript) setParciais((p) => ({ ...p, [chave]: { nome: t.name ?? "Sem nome", texto: t.transcript! } }));
        return;
      }
      setParciais((p) => {
        if (!(chave in p)) return p;
        const { [chave]: _saiu, ...resto } = p;
        void _saiu;
        return resto;
      });
      const trecho = paraTrecho(bruto);
      if (!trecho) return;
      if (ver) setAoVivo((l) => [...l, trecho]);
      if (enviar && !parado.current) fila.current = [...fila.current, trecho].slice(-FILA_MAX);
    };
    ai.on("transcript", aoFalar);
    return () => ai.off("transcript", aoFalar);
  }, [meeting, enviar, ver]);

  useEffect(() => {
    if (!enviar) return;
    const url = `/api/sala/transcricao/${sessaoId}`;
    let enviando = false;
    async function mandar(manterViva = false) {
      if (enviando || parado.current || fila.current.length === 0) return;
      enviando = true;
      const lote = fila.current.slice(0, MAX_TRECHOS_POR_LOTE);
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trechos: lote }),
          keepalive: manterViva,
        });
        if (r.ok || r.status === 400) fila.current = fila.current.slice(lote.length);
        else if (r.status === 409 || r.status === 403 || r.status === 404) {
          parado.current = true;
          fila.current = [];
        }
      } catch {
        // sem internet: tenta de novo no próximo ciclo
      } finally {
        enviando = false;
      }
    }
    const relogio = window.setInterval(() => void mandar(), ENVIO_MS);
    const aoEsconder = () => void mandar(true);
    window.addEventListener("pagehide", aoEsconder);
    return () => {
      window.clearInterval(relogio);
      window.removeEventListener("pagehide", aoEsconder);
      void mandar(true);
    };
  }, [enviar, sessaoId]);

  useEffect(() => {
    if (!ver) return;
    let cancelado = false;
    let desde: string | null = null;
    async function buscar() {
      try {
        const r = await fetch(`/api/sala/transcricao/${sessaoId}${desde ? `?desde=${encodeURIComponent(desde)}` : ""}`);
        if (!r.ok || cancelado) return;
        const j = (await r.json()) as { trechos: Trecho[]; agora: string };
        desde = j.agora;
        if (j.trechos.length) setDoServidor((l) => juntarTrechos(l, j.trechos));
      } catch {
        // tenta de novo no próximo ciclo
      }
    }
    void buscar();
    const relogio = window.setInterval(() => void buscar(), BUSCA_MS);
    return () => {
      cancelado = true;
      window.clearInterval(relogio);
    };
  }, [ver, sessaoId]);

  const [alinhado, setAlinhado] = useState<EstadoAlinhado | null>(null);
  useEffect(() => {
    if (!ver) return;
    let cancelado = false;
    async function pedir() {
      try {
        const r = await fetch(`/api/sala/alinhado/${sessaoId}`, { method: "POST" });
        if (!r.ok || cancelado) return;
        const j = (await r.json()) as EstadoAlinhado;
        // Falha da IA sem nada anterior não apaga o que a tela já mostra.
        setAlinhado((antes) => (j.estado === "falhou" && antes?.estado === "pronto" ? { ...antes, falhou: true } : j));
      } catch {
        // tenta de novo no próximo ciclo
      }
    }
    void pedir();
    const relogio = window.setInterval(() => void pedir(), ALINHADO_MS);
    return () => {
      cancelado = true;
      window.clearInterval(relogio);
    };
  }, [ver, sessaoId]);

  const trechos = useMemo(() => juntarTrechos(doServidor, aoVivo), [doServidor, aoVivo]);
  return { trechos, parciais: Object.values(parciais), alinhado };
}

const HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

/** Aba "Alinhado" da coluna: o cartão "Alinhado até agora" (IA, a cada 2 min) e, embaixo, a transcrição corrida
 *  (blocos por quem falou) com o que está sendo falado agora em cinza. A transcrição desce sozinha enquanto a pessoa
 *  está no fim da lista. */
export function AbaAlinhado({ trechos, parciais, alinhado }: { trechos: Trecho[]; parciais: Parcial[]; alinhado: EstadoAlinhado | null }) {
  const blocos = useMemo(() => agruparPorFalante(trechos), [trechos]);
  const [verTranscricao, setVerTranscricao] = useState(true);
  const fim = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const noFim = useRef(true);

  // Quem rola é o painel da coluna (pai deste bloco).
  useEffect(() => {
    const painel = caixa.current?.parentElement;
    if (!painel) return;
    const aoRolar = () => {
      noFim.current = painel.scrollHeight - painel.scrollTop - painel.clientHeight < 40;
    };
    painel.addEventListener("scroll", aoRolar);
    return () => painel.removeEventListener("scroll", aoRolar);
  }, []);

  useEffect(() => {
    if (noFim.current) fim.current?.scrollIntoView({ block: "end" });
  }, [blocos, parciais]);

  return (
    <div ref={caixa} className="p-3">
      <CartaoAlinhado alinhado={alinhado} />
      <button
        type="button"
        onClick={() => setVerTranscricao((v) => !v)}
        aria-expanded={verTranscricao}
        className="mt-4 flex w-full items-center justify-between px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-800"
      >
        Transcrição
        <span className="font-normal normal-case tracking-normal">{verTranscricao ? "Esconder" : "Ver transcrição"}</span>
      </button>
      {!verTranscricao ? null : blocos.length === 0 && parciais.length === 0 ? (
        <p className="px-1 text-sm text-zinc-500">Assim que alguém falar, a transcrição aparece aqui.</p>
      ) : (
        <ol className="space-y-3">
          {blocos.map((b, i) => (
            <li key={`${b.em}-${i}`} className="px-1 text-sm leading-relaxed">
              <p className="text-xs text-zinc-500">
                <span className="font-semibold text-zinc-700">{b.nome}</span> · {HORA.format(new Date(b.em))}
              </p>
              <p className="whitespace-pre-wrap break-words text-zinc-800">{b.textos.join(" ")}</p>
            </li>
          ))}
          {parciais.map((p, i) => (
            <li key={`parcial-${i}`} className="px-1 text-sm leading-relaxed text-zinc-400" aria-live="polite">
              <p className="text-xs font-semibold">{p.nome}</p>
              <p className="break-words italic">{p.texto}</p>
            </li>
          ))}
        </ol>
      )}
      <div ref={fim} />
    </div>
  );
}

function haQuanto(iso: string, agora: number): string {
  const min = Math.max(0, Math.floor((agora - Date.parse(iso)) / 60_000));
  return min === 0 ? "agora há pouco" : min === 1 ? "há 1 min" : `há ${min} min`;
}

function useAgora(ms: number): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const r = window.setInterval(() => setAgora(Date.now()), ms);
    return () => window.clearInterval(r);
  }, [ms]);
  return agora;
}

const COR_TEMPERATURA: Record<string, string> = {
  quente: "bg-red-50 text-red-700",
  morna: "bg-amber-50 text-amber-800",
  fria: "bg-sky-50 text-sky-800",
};

/** "Alinhado até agora": os blocos do resumo (vazio = "não falaram", em cinza), a temperatura, quando foi
 *  atualizado e "Copiar". */
function CartaoAlinhado({ alinhado }: { alinhado: EstadoAlinhado | null }) {
  const agora = useAgora(30_000);
  const [copiado, setCopiado] = useState(false);
  const titulo = <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Alinhado até agora</h3>;

  if (!alinhado || alinhado.estado !== "pronto") {
    const aviso =
      alinhado?.estado === "sem_ia" ? "O resumo automático não está configurado." :
      alinhado?.estado === "falhou" ? "Não deu pra resumir agora. Tenta de novo em 2 minutos." :
      "Depois de uns 3 minutos de conversa, o que for alinhado aparece aqui (atualiza a cada 2 minutos).";
    return (
      <section className="rounded-lg border border-zinc-100 bg-zinc-50 p-3">
        {titulo}
        <p className="mt-1 text-sm text-zinc-500">{aviso}</p>
      </section>
    );
  }

  const a: Alinhamento = alinhado.dados;
  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoDoAlinhamento(a));
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // sem permissão de área de transferência: nada a fazer
    }
  }
  return (
    <section className="rounded-lg border border-zinc-100 bg-zinc-50 p-3">
      <div className="flex items-center gap-2">
        {titulo}
        {a.temperatura && (
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${COR_TEMPERATURA[a.temperatura]}`} title={a.temperatura_motivo || undefined}>
            {a.temperatura}
          </span>
        )}
        <button type="button" onClick={copiar} className="ml-auto text-xs font-medium text-marca hover:underline">
          {copiado ? "Copiado" : "Copiar"}
        </button>
      </div>
      <dl className="mt-2 space-y-2 text-sm">
        {BLOCOS.map((b) => {
          const valor = a[b.chave];
          const itens = Array.isArray(valor) ? valor : null;
          const vazio = itens ? itens.length === 0 : !valor;
          return (
            <div key={b.chave}>
              <dt className="text-xs font-semibold text-zinc-600">{b.rotulo}</dt>
              {vazio ? (
                <dd className="text-zinc-400">{NAO_FALARAM}</dd>
              ) : itens ? (
                <dd>
                  <ul className="list-disc space-y-0.5 pl-4 text-zinc-800">
                    {itens.map((i, n) => <li key={n}>{i}</li>)}
                  </ul>
                </dd>
              ) : (
                <dd className="text-zinc-800">{valor as string}</dd>
              )}
            </div>
          );
        })}
      </dl>
      <p className="mt-2 text-[11px] text-zinc-400">
        Atualizado {haQuanto(alinhado.gerado_em, agora)}
        {alinhado.falhou ? " · a última tentativa falhou" : ""}
      </p>
    </section>
  );
}
