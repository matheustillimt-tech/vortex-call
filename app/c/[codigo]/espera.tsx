"use client";
import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { SalaDinamica } from "@/app/_sala/carregar";
import { telaSaidaConvidado, type MotivoSaida, type TelaSaidaConvidado } from "@/app/_sala/formatos";
import type { Marca, Passe } from "@/app/_sala/tipos";
import type { EstadoSala } from "@/src/lib/regras/estado-sala";
import { proximaConsulta } from "./consulta";

type Props = {
  codigo: string;
  estadoInicial: EstadoSala;
  inicioIso: string;
  abreEmIso: string;
  horaInicio: string;
  marca: Marca;
  whatsappSuporte: string | null;
};

type EstadoDeEspera = "espera" | "aguardando_anfitriao";

type Fase =
  | { tipo: "aguardando"; estado: EstadoDeEspera }
  | { tipo: "entrando" }
  | { tipo: "na_sala"; passe: Passe }
  | { tipo: "erro" }
  | { tipo: "verificando" }
  | { tipo: "saida"; tela: TelaSaidaConvidado };

const doisDigitos = (n: number) => String(n).padStart(2, "0");

function Contagem({ inicio, agora }: { inicio: string; agora: number | null }) {
  if (agora === null) return <p className="text-5xl font-semibold tabular-nums">--:--</p>;
  const falta = Math.max(0, new Date(inicio).getTime() - agora);
  const h = Math.floor(falta / 3_600_000);
  const m = Math.floor((falta % 3_600_000) / 60_000);
  const s = Math.floor((falta % 60_000) / 1000);
  return (
    <p className="text-5xl font-semibold tabular-nums">
      {h > 0 ? `${h}:${doisDigitos(m)}:${doisDigitos(s)}` : `${doisDigitos(m)}:${doisDigitos(s)}`}
    </p>
  );
}

/** Tela de espera de `/c/[codigo]`: fica abrindo o estado sozinha e, quando a sala abre, pega o passe e entra
 *  direto, sem a pessoa precisar clicar em nada. */
export function Espera({ codigo, estadoInicial, inicioIso, abreEmIso, horaInicio, marca, whatsappSuporte }: Props) {
  const [fase, setFase] = useState<Fase>(
    estadoInicial === "aberta"
      ? { tipo: "entrando" }
      : { tipo: "aguardando", estado: estadoInicial as EstadoDeEspera },
  );
  const [agora, setAgora] = useState<number | null>(null);
  const abreEmRef = useRef(new Date(abreEmIso).getTime());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [somLiberado, setSomLiberado] = useState(false);

  useEffect(() => {
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Navegador só deixa tocar som depois de um toque/tecla na página: no primeiro, toca um silêncio (AudioContext)
  // e "destrava" o elemento de áudio do aviso, que é reaproveitado quando a sala abre.
  useEffect(() => {
    if (somLiberado) return;
    const liberar = () => {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const fonte = ctx.createBufferSource();
          fonte.buffer = ctx.createBuffer(1, 1, 22050);
          fonte.connect(ctx.destination);
          fonte.start(0);
          void ctx.resume().catch(() => undefined);
        }
      } catch {
        // sem Web Audio: segue só com o elemento de áudio
      }
      try {
        const audio = audioRef.current ?? new Audio("/sons/comecou.mp3");
        audioRef.current = audio;
        audio.muted = true;
        void audio
          .play()
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
            audio.muted = false;
          })
          .catch(() => {
            audio.muted = false;
          });
      } catch {
        // navegador sem Audio: segue sem som
      }
      setSomLiberado(true);
    };
    window.addEventListener("pointerdown", liberar);
    window.addEventListener("keydown", liberar);
    return () => {
      window.removeEventListener("pointerdown", liberar);
      window.removeEventListener("keydown", liberar);
    };
  }, [somLiberado]);

  // Sala abriu (ou acabamos de tentar de novo): pede o passe e entra sozinho.
  useEffect(() => {
    if (fase.tipo !== "entrando") return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch(`/api/sala/convidado/${codigo}`, { method: "POST" });
        if (cancelado) return;
        if (r.ok) {
          const passe = (await r.json()) as Passe;
          try {
            const audio = audioRef.current ?? new Audio("/sons/comecou.mp3");
            audio.muted = false;
            audio.currentTime = 0;
            void audio.play().catch(() => undefined);
          } catch {
            // navegador bloqueou autoplay: segue sem som
          }
          document.title = "Sua call começou!";
          setFase({ tipo: "na_sala", passe });
          return;
        }
        if (r.status === 409) {
          const j = (await r.json().catch(() => null)) as { estado?: EstadoDeEspera } | null;
          setFase({ tipo: "aguardando", estado: j?.estado ?? "aguardando_anfitriao" });
          return;
        }
        setFase({ tipo: "erro" });
      } catch {
        if (!cancelado) setFase({ tipo: "erro" });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [fase.tipo, codigo]);

  // Consulta o estado enquanto espera, no ritmo de `proximaConsulta`.
  useEffect(() => {
    if (fase.tipo !== "aguardando") return;
    let cancelado = false;

    async function consultar() {
      try {
        const r = await fetch(`/api/sala/estado/${codigo}`);
        if (cancelado) return;
        if (!r.ok) {
          timerRef.current = setTimeout(consultar, 10_000);
          return;
        }
        const j = (await r.json()) as { estado: EstadoSala; abreEm: string };
        abreEmRef.current = new Date(j.abreEm).getTime();
        if (j.estado === "aberta") {
          setFase({ tipo: "entrando" });
          return;
        }
        if (j.estado === "acabou" || j.estado === "cancelada") {
          window.location.reload();
          return;
        }
        setFase({ tipo: "aguardando", estado: j.estado });
      } catch {
        if (!cancelado) timerRef.current = setTimeout(consultar, 10_000);
      }
    }

    const espera = proximaConsulta(fase.estado, abreEmRef.current - Date.now());
    timerRef.current = setTimeout(consultar, espera > 0 ? espera : 5_000);
    return () => {
      cancelado = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fase, codigo]);

  // Expulso pode ser outra aba OU "encerrar call para todos": pergunta o estado antes de decidir a tela.
  async function aoSair(motivo: MotivoSaida) {
    if (motivo !== "expulso") {
      setFase({ tipo: "saida", tela: telaSaidaConvidado(motivo, null) });
      return;
    }
    setFase({ tipo: "verificando" });
    let estado: string | null = null;
    try {
      const r = await fetch(`/api/sala/estado/${codigo}`);
      if (r.ok) estado = ((await r.json()) as { estado?: string }).estado ?? null;
    } catch {
      // sem resposta: fica com "outra aba"
    }
    setFase({ tipo: "saida", tela: telaSaidaConvidado(motivo, estado) });
  }

  if (fase.tipo === "na_sala") {
    return <SalaDinamica passe={fase.passe} marca={marca} aoSair={aoSair} atividade={{ codigo }} />;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0b0d10] px-6 text-center text-white">
      {fase.tipo === "aguardando" && (
        <>
          <Clock className="size-8 text-white/60" aria-hidden />
          {fase.estado === "espera" ? (
            <>
              <p className="text-lg font-medium">Sua call começa às {horaInicio}</p>
              <Contagem inicio={inicioIso} agora={agora} />
            </>
          ) : (
            <p className="text-lg font-medium">Aguardando o anfitrião abrir a sala…</p>
          )}
          {!somLiberado && <p className="text-xs text-white/50">Toque na tela para ativar o som do aviso.</p>}
          <p className="max-w-sm text-sm text-white/60">
            Pode deixar esta aba aberta. Na hora marcada toca um som e você entra sozinho, não precisa clicar em nada.
          </p>
          <p className="max-w-sm text-xs text-white/40">
            Esta call será gravada para fins de atendimento e qualidade. Ao entrar, você declara estar ciente.
          </p>
        </>
      )}

      {(fase.tipo === "entrando" || fase.tipo === "verificando") && (
        <>
          <span className="size-6 animate-spin rounded-full border-2 border-white/20 border-t-white" aria-hidden />
          <p className="text-lg font-medium">{fase.tipo === "entrando" ? "Preparando a sala…" : "Um instante…"}</p>
        </>
      )}

      {fase.tipo === "erro" && (
        <>
          <p className="text-lg font-medium">Não conseguimos abrir a sala.</p>
          <button
            type="button"
            onClick={() => setFase({ tipo: "entrando" })}
            className="rounded-md bg-white px-4 py-2 font-medium text-black"
          >
            Tentar de novo
          </button>
          {whatsappSuporte && (
            <a className="text-sm text-white/60 underline" href={`https://wa.me/${whatsappSuporte.replace("+", "")}`} target="_blank" rel="noreferrer">
              Falar com o suporte
            </a>
          )}
        </>
      )}

      {fase.tipo === "saida" && (
        <>
          <p className="text-lg font-medium">
            {fase.tela === "saiu"
              ? "Você saiu da call"
              : fase.tela === "outra_aba"
                ? "Você entrou em outra aba ou aparelho. Esta aba foi desconectada."
                : "A call terminou. Obrigado!"}
          </p>
          {fase.tela === "saiu" && (
            <button
              type="button"
              onClick={() => setFase({ tipo: "entrando" })}
              className="rounded-md bg-white px-4 py-2 font-medium text-black"
            >
              Voltar pra call
            </button>
          )}
        </>
      )}
    </main>
  );
}
