"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { SalaDinamica } from "@/app/_sala/carregar";
import { mensagemErroEquipe, telaSaidaEquipe, type MotivoSaida } from "@/app/_sala/formatos";
import type { Marca, Passe } from "@/app/_sala/tipos";

/** A coluna usa os hooks do RealtimeKit (só navegador), como a sala: nada dela roda no servidor. */
const ColunaFichaDinamica = dynamic(() => import("./coluna").then((m) => m.ColunaFicha), { ssr: false });

/** `verFicha`: permissão `ficha` (sem ela, a coluna mostra só o roteiro). `verTranscricao`: permissão `transcricao`
 *  (aba "Alinhado", só em sessão transcrita). `titulo`: nome da agenda, no canto da barra. */
type Props = { sessaoId: string; modo: "anfitriao" | "espiao"; marca: Marca; roteiro: string; titulo?: string; verFicha?: boolean; verTranscricao?: boolean };

type Fase =
  | { tipo: "entrando" }
  | { tipo: "na_sala"; passe: Passe }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "encerrada" }
  | { tipo: "saida"; motivo: "saiu" | "outra_aba" };

/** Entra como equipe (anfitrião ou espião) e monta a sala em tela cheia. O anfitrião ganha um botão pra encerrar
 *  a call pra todo mundo; o espião ganha uma faixa avisando que ninguém o vê. */
export function Cliente({ sessaoId, modo, marca, roteiro, titulo, verFicha = true, verTranscricao = true }: Props) {
  const [fase, setFase] = useState<Fase>({ tipo: "entrando" });
  const [encerrando, setEncerrando] = useState(false);
  const [pedidoFicha, setPedidoFicha] = useState<{ inscricaoId: string; n: number } | null>(null);
  const abrirFicha = useCallback((inscricaoId: string) => setPedidoFicha((p) => ({ inscricaoId, n: (p?.n ?? 0) + 1 })), []);

  useEffect(() => {
    if (fase.tipo !== "entrando") return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch(`/api/sala/equipe/${sessaoId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modo }),
        });
        if (cancelado) return;
        if (r.ok) {
          const passe = (await r.json()) as Passe;
          setFase({ tipo: "na_sala", passe });
          return;
        }
        const j = (await r.json().catch(() => null)) as { erro?: string; estado?: string } | null;
        setFase({ tipo: "erro", mensagem: mensagemErroEquipe(r.status, modo, j?.estado, j?.erro) });
      } catch {
        if (!cancelado) setFase({ tipo: "erro", mensagem: "Não conseguimos abrir a sala." });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [fase.tipo, sessaoId, modo]);

  // Expulso pode ser outra aba OU a call encerrada para todos: confere o status da sessão antes de decidir a tela.
  async function aoSair(motivo: MotivoSaida) {
    let status: string | null = null;
    if (motivo === "expulso") {
      try {
        const r = await fetch(`/api/sala/equipe/${sessaoId}`);
        if (r.ok) status = ((await r.json()) as { status?: string }).status ?? null;
      } catch {
        // sem resposta: fica com "outra aba"
      }
    }
    const tela = telaSaidaEquipe(motivo, status);
    setFase(tela === "encerrada" ? { tipo: "encerrada" } : { tipo: "saida", motivo: tela });
  }

  async function encerrarParaTodos() {
    if (!window.confirm("Isso tira todo mundo da sala. Encerrar?")) return;
    setEncerrando(true);
    try {
      const r = await fetch(`/api/sala/encerrar/${sessaoId}`, { method: "POST" });
      // 409: outra pessoa da equipe (ou o cron) já encerrou.
      if (r.ok || r.status === 409) {
        setFase({ tipo: "encerrada" });
        return;
      }
      setEncerrando(false);
      window.alert("Não conseguimos encerrar a sala. Tente de novo.");
    } catch {
      setEncerrando(false);
      window.alert("Não conseguimos encerrar a sala. Tente de novo.");
    }
  }

  if (fase.tipo === "entrando") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-white text-sm text-zinc-500">
        <span className="size-6 animate-spin rounded-full border-2 border-zinc-200 border-t-marca" aria-hidden />
        <p>Preparando a sala…</p>
      </div>
    );
  }

  if (fase.tipo === "erro") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <p className="text-base text-zinc-700">{fase.mensagem}</p>
        <button
          type="button"
          onClick={() => setFase({ tipo: "entrando" })}
          className="rounded-md bg-marca px-4 py-2 text-sm font-medium text-white hover:bg-marca-escura"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  if (fase.tipo === "encerrada") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <p className="text-base text-zinc-700">Call encerrada.</p>
        <a href={`/sessoes/${sessaoId}`} className="rounded-md bg-marca px-4 py-2 text-sm font-medium text-white hover:bg-marca-escura">
          Voltar pra sessão
        </a>
      </div>
    );
  }

  if (fase.tipo === "saida") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <p className="text-base text-zinc-700">
          {fase.motivo === "outra_aba" ? "Você entrou em outra aba ou aparelho. Esta aba foi desconectada." : "Você saiu da call."}
        </p>
        <a href={`/sessoes/${sessaoId}`} className="rounded-md bg-marca px-4 py-2 text-sm font-medium text-white hover:bg-marca-escura">
          Voltar pra sessão
        </a>
      </div>
    );
  }

  return (
    <div className="relative h-dvh">
      {modo === "espiao" && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 bg-zinc-900/90 py-1 text-center text-xs font-medium text-white">
          Modo espião: ninguém está te vendo
        </div>
      )}
      {modo === "anfitriao" && (
        <div className="fixed right-3 top-3 z-50">
          <button
            type="button"
            onClick={encerrarParaTodos}
            disabled={encerrando}
            className="rounded-md bg-erro px-3 py-1.5 text-sm font-medium text-white shadow-md hover:bg-erro-hover disabled:opacity-50"
          >
            Encerrar call para todos
          </button>
        </div>
      )}
      <SalaDinamica
        passe={fase.passe}
        marca={marca}
        aoSair={aoSair}
        colunaEsquerda={
          <ColunaFichaDinamica
            sessaoId={sessaoId}
            roteiro={roteiro}
            verFicha={verFicha}
            pedido={pedidoFicha}
            transcricao={fase.passe.transcreve ? { enviar: modo === "anfitriao", ver: verTranscricao } : undefined}
          />
        }
        gravacao={modo === "anfitriao" ? { tipo: "sessao", id: sessaoId } : undefined}
        convite={modo === "anfitriao" ? { sessaoId } : undefined}
        titulo={titulo}
        avisarEntradas
        aoClicarLead={verFicha ? abrirFicha : undefined}
      />
    </div>
  );
}
