"use client";
import { useEffect, useState } from "react";
import { useRealtimeKitSelector } from "@cloudflare/realtimekit-react";
import { Loader2 } from "lucide-react";
import { BotaoRedondo } from "./botoes";
import { estadoBotaoGravar } from "./formatos";
import type { AlvoGravacao } from "./tipos";

function IconeGravar({ parar }: { parar: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="vc-icone" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      {parar ? <rect x="8.5" y="8.5" width="7" height="7" rx="1" fill="currentColor" stroke="none" /> : <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />}
    </svg>
  );
}

/** Botão Gravar / Parar gravação do anfitrião. Fala com `POST /api/sala/gravar/{id}` (a gravação começa pela API pra
 *  ir pro R2 da empresa); o estado vem do RealtimeKit (`meeting.recording.recordingState`), então o "● Gravando" do
 *  topo e o botão mudam juntos quando a gravação começa de fato. */
export function BotaoGravar({ alvo }: { alvo: AlvoGravacao }) {
  const estado = useRealtimeKitSelector((m) => m.recording.recordingState);
  const [pedindo, setPedindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const botao = estadoBotaoGravar(estado, pedindo);

  // A gravação mudou de estado (começou, parou): o erro do pedido anterior não vale mais.
  useEffect(() => {
    setErro(null);
  }, [estado]);

  async function alternar() {
    if (botao.ocupado) return;
    setPedindo(true);
    setErro(null);
    try {
      const r = await fetch(`/api/sala/gravar/${alvo.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tipo: alvo.tipo, ligar: botao.ligar }),
      });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { erro?: string } | null;
        setErro(corpo?.erro ?? (botao.ligar ? "Não deu para começar a gravar." : "Não deu para parar a gravação."));
      }
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setPedindo(false);
    }
  }

  return (
    <div className="relative">
      <BotaoRedondo
        rotulo={botao.rotulo}
        icone={botao.ocupado ? <Loader2 className="vc-icone animate-spin" /> : <IconeGravar parar={botao.ativo} />}
        estado={botao.ativo ? "ativo" : "neutro"}
        className={botao.ativo ? "vc-botao-gravando" : undefined}
        pressionado={botao.ativo}
        ocupado={botao.ocupado}
        disabled={botao.ocupado}
        onClick={() => void alternar()}
      />
      {erro && (
        <p role="alert" className="absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-2 text-center text-xs text-erro shadow-lg">
          {erro}
        </p>
      )}
    </div>
  );
}
