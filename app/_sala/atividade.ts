import { useEffect } from "react";
import type { Meeting } from "./tipos";

/** Intervalo entre os envios da atividade (o servidor aceita no máximo 35 s de microfone/câmera por envio). */
export const INTERVALO_ENVIO_MS = 30_000;

export type Colheita = { mic: number; cam: number; msgs: number };

export type Acumulador = {
  marcarAudio(ligado: boolean, agoraMs: number): void;
  marcarVideo(ligado: boolean, agoraMs: number): void;
  mensagemEnviada(): void;
  /** Segundos inteiros de microfone e câmera ligados e mensagens enviadas desde a última colheita. Zera a contagem e
   *  guarda o resto de menos de 1 s pra próxima. */
  colher(agoraMs: number): Colheita;
};

type Faixa = { desde: number | null; ms: number };

function marcar(f: Faixa, ligado: boolean, agora: number) {
  if (ligado) {
    if (f.desde === null) f.desde = agora;
    return;
  }
  if (f.desde !== null) {
    f.ms += Math.max(0, agora - f.desde);
    f.desde = null;
  }
}

function tirarSegundos(f: Faixa, agora: number): number {
  if (f.desde !== null) {
    f.ms += Math.max(0, agora - f.desde);
    f.desde = agora;
  }
  const s = Math.floor(f.ms / 1000);
  f.ms -= s * 1000;
  return s;
}

/** Conta, no navegador do convidado, quanto tempo o microfone e a câmera ficaram ligados e quantas mensagens ele
 *  mandou no chat. Puro (o relógio vem de fora), pra dar pra testar. */
export function criarAcumulador(): Acumulador {
  const mic: Faixa = { desde: null, ms: 0 };
  const cam: Faixa = { desde: null, ms: 0 };
  let msgs = 0;
  return {
    marcarAudio: (ligado, agora) => marcar(mic, ligado, agora),
    marcarVideo: (ligado, agora) => marcar(cam, ligado, agora),
    mensagemEnviada: () => {
      msgs++;
    },
    colher(agora) {
      const r = { mic: tirarSegundos(mic, agora), cam: tirarSegundos(cam, agora), msgs };
      msgs = 0;
      return r;
    },
  };
}

/** Só na sala do convidado: ouve o próprio microfone, a câmera e as mensagens dele no chat e manda a soma pra
 *  `POST /api/sala/atividade/{codigo}` a cada 30 s, quando a aba fica escondida (o navegador segura o timer de aba em
 *  segundo plano, e o servidor só aceita 35 s por envio) e ao sair da página (`sendBeacon`). Envio todo zerado não sai. */
export function useAtividade(meeting: Meeting | undefined, codigo: string | undefined, ativo: boolean) {
  useEffect(() => {
    if (!ativo || !meeting || !codigo) return;
    const url = `/api/sala/atividade/${codigo}`;
    const acc = criarAcumulador();
    acc.marcarAudio(meeting.self.audioEnabled, Date.now());
    acc.marcarVideo(meeting.self.videoEnabled, Date.now());

    const aoMudarAudio = ({ audioEnabled }: { audioEnabled: boolean }) => acc.marcarAudio(audioEnabled, Date.now());
    const aoMudarVideo = ({ videoEnabled }: { videoEnabled: boolean }) => acc.marcarVideo(videoEnabled, Date.now());
    const aoMudarChat = ({ action, message }: { action: string; message?: { userId?: string } }) => {
      if (action === "add" && message?.userId && message.userId === meeting.self.userId) acc.mensagemEnviada();
    };
    const aoDeixarSala = () => {
      acc.marcarAudio(false, Date.now());
      acc.marcarVideo(false, Date.now());
    };

    function enviar(saindo: boolean) {
      const d = acc.colher(Date.now());
      if (d.mic === 0 && d.cam === 0 && d.msgs === 0) return;
      const corpo = JSON.stringify(d);
      try {
        if (saindo && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
          if (navigator.sendBeacon(url, new Blob([corpo], { type: "application/json" }))) return;
        }
        void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: corpo, keepalive: true }).catch(
          () => undefined,
        );
      } catch {
        // sem rede: perde este envio, a sala segue normal
      }
    }
    const aoEsconderPagina = () => enviar(true);
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === "hidden") enviar(true);
    };

    meeting.self.on("audioUpdate", aoMudarAudio);
    meeting.self.on("videoUpdate", aoMudarVideo);
    meeting.self.on("roomLeft", aoDeixarSala);
    meeting.chat.on("chatUpdate", aoMudarChat);
    window.addEventListener("pagehide", aoEsconderPagina);
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    const t = setInterval(() => enviar(false), INTERVALO_ENVIO_MS);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", aoEsconderPagina);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      meeting.self.removeListener("audioUpdate", aoMudarAudio);
      meeting.self.removeListener("videoUpdate", aoMudarVideo);
      meeting.self.removeListener("roomLeft", aoDeixarSala);
      meeting.chat.removeListener("chatUpdate", aoMudarChat);
      enviar(true);
    };
  }, [meeting, codigo, ativo]);
}
