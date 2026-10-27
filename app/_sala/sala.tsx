"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RealtimeKitProvider, useRealtimeKitClient } from "@cloudflare/realtimekit-react";
import {
  RtkDialogManager,
  RtkNotifications,
  RtkParticipantsAudio,
  RtkUiProvider,
  createDefaultConfig,
  provideRtkDesignSystem,
  type States,
  type UIConfig,
} from "@cloudflare/realtimekit-react-ui";
import { useAtividade } from "./atividade";
import { Barra } from "./barra";
import { Carregando } from "./carregando";
import { ChatLateral } from "./chat-lateral";
import { useAvisoEntradas } from "./entradas";
import { motivoDaSaida } from "./formatos";
import { Palco } from "./palco";
import { textosSala } from "./textos";
import type { SalaProps } from "./tipos";
import { Topo } from "./topo";
import "./sala.css";

type TokensDeDesign = NonNullable<UIConfig["designTokens"]>;
const COR_PADRAO = "#0A8452";

/** Cor da marca configurada no painel (ou a padrão, se vier inválida). */
function corDaMarca(cor: string): string {
  return /^#[0-9a-f]{6}$/i.test(cor) ? cor : COR_PADRAO;
}

/** Tema claro com a cor da marca em todos os tons (avatar com iniciais, barrinhas de fala, botões ativos). */
function tokensDaMarca(cor: string): TokensDeDesign {
  const marca = corDaMarca(cor);
  return {
    theme: "light",
    fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
    borderRadius: "extra-rounded",
    colors: {
      brand: { 300: marca, 400: marca, 500: marca, 600: marca, 700: marca },
      background: { 1000: "#FFFFFF", 900: "#F4F4F5", 800: "#E4E4E7", 700: "#D4D4D8", 600: "#A1A1AA" },
      text: "#18181B",
      "text-on-brand": "#FFFFFF",
      "video-bg": "#E4E4E7",
      danger: "#DC2626",
      success: "#16A34A",
      warning: "#D97706",
    },
  };
}

/**
 * A sala: entra direto (sem tela de configuração, microfone e câmera desligados), com topo, palco, chat lateral e
 * barra no layout da referência. O `RtkUiProvider` entrega reunião, textos e estado aos componentes do kit e faz o
 * `join()` sozinho quando `showSetupScreen` é falso.
 */
export function Sala({ passe, marca, aoSair, colunaEsquerda, gravacao, atividade, titulo, convite, avisarEntradas = false, aoClicarLead }: SalaProps) {
  const [meeting, initMeeting] = useRealtimeKitClient();
  const [falhou, setFalhou] = useState(false);
  const [chatAberto, setChatAberto] = useState(false);
  const [erroEntrada, setErroEntrada] = useState<string | null>(null);
  const [reconectando, setReconectando] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const aoSairAtual = useRef(aoSair);
  useAtividade(meeting, atividade?.codigo, atividade !== undefined && passe.papel === "convidado");
  const avisos = useAvisoEntradas(meeting, { ativo: avisarEntradas, titulo, icone: marca.logoUrl });

  const tokens = useMemo(() => tokensDaMarca(marca.cor), [marca.cor]);
  // Com o aviso de entradas ligado, o sino próprio (só pra cliente) substitui o som de "entrou" do kit.
  const config = useMemo<UIConfig>(() => {
    const base = createDefaultConfig();
    if (!avisarEntradas) return { ...base, designTokens: tokens };
    const extra = base.config ?? {};
    return {
      ...base,
      designTokens: tokens,
      config: { ...extra, notification_sounds: { ...extra.notification_sounds, participant_joined: false } },
    };
  }, [tokens, avisarEntradas]);

  useEffect(() => {
    aoSairAtual.current = aoSair;
  }, [aoSair]);

  useLayoutEffect(() => {
    if (raiz.current) provideRtkDesignSystem(raiz.current, tokens);
  }, [tokens]);

  useEffect(() => {
    initMeeting({ authToken: passe.token, defaults: { audio: false, video: false } }).catch(() => setFalhou(true));
  }, [initMeeting, passe.token]);

  useEffect(() => {
    if (!meeting) return;
    const aoDeixarSala = ({ state }: { state: string }) => {
      const motivo = motivoDaSaida(state);
      if (motivo) aoSairAtual.current(motivo);
    };
    const aoMudarConexao = ({ state }: { state: string }) => setReconectando(state !== "connected");
    meeting.self.on("roomLeft", aoDeixarSala);
    meeting.meta.on("socketConnectionUpdate", aoMudarConexao);
    return () => {
      meeting.self.removeListener("roomLeft", aoDeixarSala);
      meeting.meta.removeListener("socketConnectionUpdate", aoMudarConexao);
      // Saiu da página sem passar pelo botão (navegação do app): não deixa a presença pendurada.
      if (meeting.self.roomJoined) void meeting.leave().catch(() => undefined);
    };
  }, [meeting]);

  function aoMudarEstados(e: CustomEvent<States>) {
    const s = e.detail;
    setChatAberto(s.activeSidebar === true && s.sidebar === "chat");
    setErroEntrada(s.preJoinError ? s.preJoinError.message : null);
  }

  let conteudo: React.ReactNode;
  if (!meeting) {
    conteudo = falhou ? (
      <Aviso texto="Não deu para entrar na sala. Confira sua internet e recarregue a página." />
    ) : (
      <Carregando texto="Entrando na sala…" />
    );
  } else {
    conteudo = (
      <RealtimeKitProvider value={meeting}>
        <RtkUiProvider
          t={textosSala}
          config={config}
          showSetupScreen={false}
          meeting={meeting}
          onRtkStatesUpdate={aoMudarEstados}
          className="flex min-h-0 flex-1 flex-col"
        >
          {reconectando && (
            <div role="status" className="shrink-0 bg-amber-100 py-1.5 text-center text-sm font-medium text-amber-900">
              Reconectando…
            </div>
          )}
          <Topo marca={marca} transcreve={passe.transcreve === true} />
          <div className="relative flex min-h-0 flex-1">
            {colunaEsquerda}
            <main className="relative flex min-w-0 flex-1 flex-col">
              {erroEntrada ? <Aviso texto={erroEntrada} /> : <Palco meeting={meeting} aoClicarLead={aoClicarLead} />}
              <RtkNotifications meeting={meeting} className="vc-avisos" />
            </main>
            {chatAberto && <ChatLateral meeting={meeting} />}
          </div>
          <Barra meeting={meeting} papel={passe.papel} gravacao={gravacao} chatAberto={chatAberto} titulo={titulo} convite={convite} avisos={avisos} />
          <RtkDialogManager meeting={meeting} />
          <RtkParticipantsAudio meeting={meeting} />
        </RtkUiProvider>
      </RealtimeKitProvider>
    );
  }

  return (
    <div
      ref={raiz}
      className="vc-sala flex h-dvh flex-col overflow-hidden bg-white text-zinc-900"
      style={{ "--vc-marca": corDaMarca(marca.cor) } as React.CSSProperties}
    >
      {conteudo}
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="max-w-sm text-base text-zinc-700">{texto}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-marca px-4 py-2 text-sm font-medium text-white hover:bg-marca-escura"
      >
        Recarregar
      </button>
    </div>
  );
}
