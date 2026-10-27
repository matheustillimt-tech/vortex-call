"use client";
import { useEffect, useState } from "react";
import { useRealtimeKitSelector } from "@cloudflare/realtimekit-react";
import { formatarTempo, rotuloPessoas } from "./formatos";
import type { Marca } from "./tipos";

export const TEXTO_TRANSCRICAO = "Esta call é transcrita para registrar o que for combinado.";

/** Conta o tempo desde que a gravação foi vista começar (ao entrar com ela já rodando, conta a partir da entrada). */
function useTempoGravando(gravando: boolean): number | null {
  const [inicio, setInicio] = useState<number | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (!gravando) {
      setInicio(null);
      return;
    }
    const comeco = Date.now();
    setInicio(comeco);
    setAgora(comeco);
    const relogio = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(relogio);
  }, [gravando]);

  return inicio === null ? null : Math.max(0, (agora - inicio) / 1000);
}

/** `transcreve`: aviso fixo (LGPD) pra todos na sala de que a call é transcrita. */
export function Topo({ marca, transcreve = false }: { marca: Marca; transcreve?: boolean }) {
  const gravando = useRealtimeKitSelector((m) => m.recording.recordingState === "RECORDING");
  const outros = useRealtimeKitSelector((m) => m.participants.joined.size);
  const segundos = useTempoGravando(gravando);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-100 bg-white px-4 max-pn-sm:h-12 max-pn-sm:px-3">
      {marca.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo vem de URL configurada no painel
        <img src={marca.logoUrl} alt={marca.nome} className="h-7 w-auto max-w-40 object-contain" />
      ) : (
        <span className="text-base font-bold tracking-tight" style={{ color: marca.cor }}>
          {marca.nome}
        </span>
      )}
      {segundos !== null && (
        <>
          <span className="h-5 w-px bg-zinc-200" aria-hidden />
          <span className="flex items-center gap-1.5 text-sm font-medium text-red-600" role="status">
            <span className="size-2 animate-pulse rounded-full bg-red-600" aria-hidden />
            Gravando · {formatarTempo(segundos)}
          </span>
        </>
      )}
      {transcreve && (
        <>
          <span className="h-5 w-px bg-zinc-200" aria-hidden />
          <span className="min-w-0 truncate text-xs text-zinc-500" role="note">
            <span className="max-pn-sm:hidden">{TEXTO_TRANSCRICAO}</span>
            <span className="hidden max-pn-sm:inline">Call transcrita</span>
          </span>
        </>
      )}
      <span className="ml-auto shrink-0 font-mono text-xs text-zinc-500">{rotuloPessoas(outros + 1)}</span>
    </header>
  );
}
