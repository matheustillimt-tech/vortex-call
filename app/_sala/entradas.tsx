"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { BotaoRedondo } from "./botoes";
import {
  avaliarEntrada,
  estadoSino,
  marcarQueEntrei,
  novoVigia,
  preferenciaLigada,
  tituloComAvisos,
  type Entrada,
  type PermissaoAviso,
} from "./entradas-regras";
import type { Meeting } from "./tipos";

const CHAVE_PREFERENCIA = "vc:avisar-entradas";

/** O que a barra precisa pra desenhar o sino. */
export type ControleAvisos = { ligado: boolean; permissao: PermissaoAviso; alternar: () => void };

function lerPreferencia(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_PREFERENCIA);
  } catch {
    return null;
  }
}

function gravarPreferencia(ligado: boolean): void {
  try {
    window.localStorage.setItem(CHAVE_PREFERENCIA, ligado ? "1" : "0");
  } catch {
    // sem armazenamento (janela anônima, bloqueio): vale só nesta aba
  }
}

function permissaoAtual(): PermissaoAviso {
  if (typeof window === "undefined" || !("Notification" in window)) return "sem_suporte";
  return Notification.permission;
}

/** Dois toques curtos e baixinhos (dó e mi agudos), gerados na hora: sem arquivo de som. */
function tocarSino(ctx: AudioContext): void {
  const t0 = ctx.currentTime + 0.02;
  [1046.5, 1318.5].forEach((freq, i) => {
    const inicio = t0 + i * 0.14;
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    ganho.gain.setValueAtTime(0, inicio);
    ganho.gain.linearRampToValueAtTime(0.08, inicio + 0.015);
    ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.28);
    osc.connect(ganho).connect(ctx.destination);
    osc.start(inicio);
    osc.stop(inicio + 0.3);
  });
}

/**
 * Avisa a equipe quando um cliente entra na sala (lead, convidado do link ou visitante da reunião instantânea; quem
 * já estava quando eu entrei, eu mesmo e a equipe não contam). Sempre toca o sino. Aba visível: o aviso
 * "Fulano entrou" do próprio kit (`RtkNotifications`) aparece no palco. Aba escondida: notificação do sistema
 * ("Fulano entrou na sala", clicar volta pra aba) e o título vira "(N) Fulano entrou · Vórtex" até a aba voltar.
 * O sino da barra liga e desliga tudo (padrão ligado, guardado no navegador).
 */
export function useAvisoEntradas(meeting: Meeting | undefined, o: { ativo: boolean; titulo?: string; icone?: string | null }): ControleAvisos | undefined {
  const [ligado, setLigado] = useState(true);
  const [permissao, setPermissao] = useState<PermissaoAviso>("sem_suporte");
  const ligadoAtual = useRef(ligado);
  const textos = useRef({ titulo: o.titulo, icone: o.icone });
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    textos.current = { titulo: o.titulo, icone: o.icone };
  }, [o.titulo, o.icone]);

  useEffect(() => {
    setLigado(preferenciaLigada(lerPreferencia()));
    setPermissao(permissaoAtual());
  }, []);

  useEffect(() => {
    ligadoAtual.current = ligado;
  }, [ligado]);

  // O navegador só deixa tocar som depois de um clique na página: o primeiro clique já prepara o áudio.
  const prepararAudio = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audio.current) {
      try {
        audio.current = new Ctx();
      } catch {
        return null;
      }
    }
    if (audio.current.state === "suspended") void audio.current.resume().catch(() => undefined);
    return audio.current;
  }, []);

  useEffect(() => {
    if (!o.ativo) return;
    const destravar = () => prepararAudio();
    document.addEventListener("pointerdown", destravar, { once: true });
    document.addEventListener("keydown", destravar, { once: true });
    return () => {
      document.removeEventListener("pointerdown", destravar);
      document.removeEventListener("keydown", destravar);
    };
  }, [o.ativo, prepararAudio]);

  useEffect(() => {
    if (!o.ativo || !meeting) return;
    const vigia = novoVigia();
    let tituloOriginal: string | null = null;
    let naoVistos = 0;
    const abertas = new Set<Notification>();

    const lista = (): Entrada[] =>
      meeting.participants.joined.toArray().map((p) => ({ id: p.id, customId: p.customParticipantId ?? null, nome: p.name }));
    const aoEuEntrar = () => marcarQueEntrei(vigia, Date.now(), lista());
    if (meeting.self.roomJoined) aoEuEntrar();

    const restaurarTitulo = () => {
      if (document.visibilityState !== "visible") return;
      if (tituloOriginal !== null) document.title = tituloOriginal;
      tituloOriginal = null;
      naoVistos = 0;
      for (const n of abertas) n.close();
      abertas.clear();
    };

    const aoEntrar = (p: { id: string; customParticipantId?: string | null; name: string }) => {
      const aviso = avaliarEntrada(vigia, { id: p.id, customId: p.customParticipantId ?? null, nome: p.name }, { agora: Date.now(), euId: meeting.self.id });
      if (!aviso || !ligadoAtual.current) return;
      const ctx = prepararAudio();
      if (ctx) tocarSino(ctx);
      if (document.visibilityState === "visible") return; // o aviso do kit aparece no palco
      if (tituloOriginal === null) tituloOriginal = document.title;
      naoVistos += 1;
      document.title = tituloComAvisos(naoVistos, aviso.primeiroNome);
      if (permissaoAtual() !== "granted") return;
      try {
        const n = new Notification(`${aviso.nome} entrou na sala`, {
          body: textos.current.titulo ?? "",
          icon: textos.current.icone ?? undefined,
          tag: `vc-entrou:${aviso.chave}`,
        });
        abertas.add(n);
        n.onclick = () => {
          window.focus();
          n.close();
        };
        n.onclose = () => abertas.delete(n);
      } catch {
        // navegador que só notifica pelo service worker (celular): fica o som e o título
      }
    };

    meeting.self.on("roomJoined", aoEuEntrar);
    meeting.participants.joined.on("participantJoined", aoEntrar);
    document.addEventListener("visibilitychange", restaurarTitulo);
    return () => {
      meeting.self.removeListener("roomJoined", aoEuEntrar);
      meeting.participants.joined.removeListener("participantJoined", aoEntrar);
      document.removeEventListener("visibilitychange", restaurarTitulo);
      if (tituloOriginal !== null) document.title = tituloOriginal;
    };
  }, [o.ativo, meeting, prepararAudio]);

  const alternar = useCallback(() => {
    prepararAudio();
    const { acao } = estadoSino(ligadoAtual.current, permissaoAtual());
    if (acao === "desligar") {
      setLigado(false);
      gravarPreferencia(false);
      return;
    }
    setLigado(true);
    gravarPreferencia(true);
    if (permissaoAtual() === "default") {
      void Notification.requestPermission()
        .then((p) => setPermissao(p))
        .catch(() => setPermissao(permissaoAtual()));
    }
  }, [prepararAudio]);

  if (!o.ativo) return undefined;
  return { ligado, permissao, alternar };
}

/** Sino redondo da barra: liga e desliga o aviso de quem entra (som, notificação e título da aba). */
export function BotaoAvisos({ controle }: { controle: ControleAvisos }) {
  const { rotulo, ativo } = estadoSino(controle.ligado, controle.permissao);
  return (
    <BotaoRedondo
      rotulo={rotulo}
      icone={controle.ligado ? <Bell className="vc-icone" /> : <BellOff className="vc-icone" />}
      estado={ativo ? "ativo" : "neutro"}
      pressionado={controle.ligado}
      onClick={controle.alternar}
    />
  );
}
