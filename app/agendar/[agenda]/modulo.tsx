"use client";
import { useEffect, useRef, useState } from "react";
import type { AgendaPublica } from "@/src/lib/agendamento";
import { formatarSessao } from "@/src/lib/regras/fuso";
import type { ItemVitrine } from "@/src/lib/regras/vitrine";
import type { Prefill } from "@/src/lib/regras/encaixe";

type Confirmacao = { resultado: string; inicio: string; codigo?: string; link?: string; googleAgenda?: string };

const FUSO = "America/Sao_Paulo";
const TEXTO_WHATSAPP = "O link da sua call está no WhatsApp que você cadastrou.";

export function Modulo({ agenda, sessoes: iniciais, prefill }: { agenda: AgendaPublica; sessoes: ItemVitrine[]; prefill: Prefill }) {
  const [sessoes, setSessoes] = useState(iniciais);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [nome, setNome] = useState(prefill.nome);
  const [whatsapp, setWhatsapp] = useState(prefill.whatsapp);
  const [email, setEmail] = useState(prefill.email ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState<Confirmacao | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  // Fica escondido na primeira visão quando o prefill já trouxe nome e WhatsApp; mas se o servidor recusar
  // os dados (400, ex.: e-mail inválido), abre os campos pra pessoa corrigir em vez de travar o lead.
  const [mostrarCampos, setMostrarCampos] = useState(!prefill.nome || !prefill.whatsapp);

  useEffect(() => {
    if (!prefill.embed || !caixa.current) return;
    const avisar = () => window.parent.postMessage({ tipo: "vortex-call:altura", altura: caixa.current!.scrollHeight }, "*");
    const obs = new ResizeObserver(avisar);
    obs.observe(caixa.current);
    avisar();
    return () => obs.disconnect();
  }, [prefill.embed]);

  async function recarregar() {
    try {
      const r = await fetch(`/api/agendamento/${agenda.slug}`, { cache: "no-store" });
      if (r.ok) setSessoes((await r.json()).sessoes);
    } catch {
      // mantém a lista atual se a recarga falhar
    }
  }

  async function confirmar() {
    if (!escolhida) return;
    setEnviando(true);
    setErro(null);
    const r = await fetch(`/api/agendamento/${agenda.slug}/inscrever`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessao: escolhida, nome, whatsapp, email, resposta: prefill.resposta, utm: prefill.utm, origem: prefill.embed ? "encaixe" : "pagina" }),
    });
    const j = await r.json().catch(() => ({ erro: "Não deu para agendar." }));
    setEnviando(false);
    if (!r.ok) {
      setErro(j.erro ?? "Não deu para agendar.");
      if (r.status === 409) {
        setEscolhida(null);
        await recarregar();
      }
      if (r.status === 400) {
        // Dado prefilled inválido (nome/WhatsApp/e-mail): abre os campos pra pessoa corrigir em vez de travar o lead.
        setMostrarCampos(true);
      }
      return;
    }
    setOk(j);
    if (prefill.embed) {
      window.parent.postMessage(
        { tipo: "vortex-call:agendado", sessao: escolhida, resultado: j.resultado, inicio: j.inicio, ...(j.resultado === "nova" ? { codigo: j.codigo, link: j.link } : {}) },
        "*",
      );
    }
  }

  return (
    <div ref={caixa} className="w-full max-w-md rounded-xl border border-borda bg-superficie p-5 text-texto shadow-sm">
      {ok ? (
        <div className="grid gap-3 text-center">
          <p className="text-2xl">✅</p>
          <h1 className="text-lg font-semibold">
            {ok.resultado === "nova" ? "Agendado!" : ok.resultado === "reagendada" ? "Horário trocado!" : "Você já está inscrito nesse horário"}
          </h1>
          <p className="text-texto-3">Sua call é {formatarSessao(new Date(ok.inicio), FUSO)}.</p>
          {ok.resultado === "nova" ? (
            <>
              <p className="text-texto-3">Guarde o seu link:</p>
              <a className="break-all font-medium text-marca" href={ok.link}>{ok.link}</a>
              <a className="rounded-md border border-borda px-4 py-2 font-medium" href={ok.googleAgenda} target="_blank" rel="noreferrer">Adicionar ao Google Agenda</a>
            </>
          ) : (
            <p className="text-texto-3">{TEXTO_WHATSAPP}</p>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          <div>
            <h1 className="text-lg font-semibold">{agenda.titulo_publico}</h1>
            {agenda.descricao && <p className="mt-1 text-texto-3">{agenda.descricao}</p>}
          </div>
          {sessoes.length === 0 ? (
            <p className="text-texto-3">Nenhum horário aberto agora. Volte mais tarde.</p>
          ) : (
            <ul className="grid gap-2">
              {sessoes.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={s.lotada}
                    onClick={() => setEscolhida(s.id)}
                    className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition ${escolhida === s.id ? "border-marca bg-marca-linha" : "border-borda"} disabled:opacity-50`}
                  >
                    <span className="font-medium capitalize">{formatarSessao(new Date(s.inicio), FUSO)}</span>
                    <span className="text-xs text-texto-3">{s.lotada ? "Lotada" : `${s.restantes} ${s.restantes === 1 ? "vaga" : "vagas"}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {escolhida && mostrarCampos && (
            <div className="grid gap-2">
              <input className="rounded-md border border-borda px-3 py-2" placeholder="Seu nome" value={nome} onChange={(e) => setNome(e.target.value)} />
              <input className="rounded-md border border-borda px-3 py-2" placeholder="WhatsApp com DDD" inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
              <input className="rounded-md border border-borda px-3 py-2" placeholder="Seu e-mail" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          )}
          {erro && <p className="text-sm text-erro">{erro}</p>}
          <button type="button" disabled={!escolhida || enviando} onClick={confirmar} className="rounded-md bg-marca px-4 py-3 font-semibold text-white disabled:opacity-50">
            {enviando ? "Agendando…" : "Confirmar horário"}
          </button>
        </div>
      )}
    </div>
  );
}
