"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeKitSelector } from "@cloudflare/realtimekit-react";
import { EllipsisVertical, MessageSquareText, MicOff, MonitorUp, MonitorX, PhoneOff, Settings } from "lucide-react";
import { controlesDaBarra, formatarRelogio, itensDoMais, type Controle } from "./barra-regras";
import { avisarKit, BotaoRedondo, useFecharFora } from "./botoes";
import { BotaoMidia } from "./dispositivos";
import { BotaoFundo } from "./fundo";
import { BotaoConvite } from "./convite";
import { BotaoAvisos, type ControleAvisos } from "./entradas";
import { BotaoGravar } from "./gravar";
import type { AlvoGravacao, Meeting, Passe } from "./tipos";

type BarraProps = {
  meeting: Meeting;
  papel: Passe["papel"];
  gravacao?: AlvoGravacao;
  /** Chat aberto (vem do estado do `RtkUiProvider`): o botão fica marcado e as não lidas zeram. */
  chatAberto: boolean;
  /** Nome da call no canto esquerdo ("08:20 | Nome da call"). Sem ele, só a hora. */
  titulo?: string;
  /** Sessão do botão "Copiar link de convidado" (só a sala da equipe passa; só o anfitrião vê). */
  convite?: { sessaoId: string };
  /** Sino "Avisar quando alguém entrar" (sala da equipe e reunião do anfitrião). */
  avisos?: ControleAvisos;
};

/**
 * Barra de baixo: hora e nome da call à esquerda; no centro, botões redondos só com ícone
 * (o nome aparece no tooltip) e o "Sair" vermelho por último; chat à direita. Microfone e câmera são pílulas com a
 * setinha que abre o menu de aparelhos. Quem vê o quê: `controlesDaBarra` (espião só sai e lê o chat; Gravar só pro
 * anfitrião com alvo de gravação; Tela pro anfitrião e participante). Os diálogos (sair, configurações, silenciar
 * todos, permissão) continuam sendo do kit: os botões mandam o mesmo `rtkStateUpdate` que os botões do kit mandavam.
 * Até 900 px a hora some e os botões quebram linha centralizados.
 */
export function Barra({ meeting, papel, gravacao, chatAberto, titulo, convite, avisos }: BarraProps) {
  const [telaNoAparelho] = useState(() => typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function");
  const { centro, direita } = controlesDaBarra(papel, { gravacao: gravacao !== undefined, telaNoAparelho, convite: convite !== undefined, avisos: avisos !== undefined });

  function controle(c: Controle) {
    switch (c) {
      case "microfone":
        return <BotaoMidia key={c} meeting={meeting} tipo="audio" />;
      case "camera":
        return <BotaoMidia key={c} meeting={meeting} tipo="video" />;
      case "tela":
        return <BotaoTela key={c} meeting={meeting} />;
      case "gravar":
        return gravacao ? <BotaoGravar key={c} alvo={gravacao} /> : null;
      case "convite":
        return convite ? <BotaoConvite key={c} sessaoId={convite.sessaoId} /> : null;
      case "avisos":
        return avisos ? <BotaoAvisos key={c} controle={avisos} /> : null;
      case "fundo":
        return <BotaoFundo key={c} meeting={meeting} />;
      case "mais":
        return <BotaoMais key={c} papel={papel} />;
      case "sair":
        return <BotaoSair key={c} />;
      case "chat":
        return <BotaoChat key={c} meeting={meeting} aberto={chatAberto} />;
    }
  }

  return (
    <footer className="vc-barra grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 bg-white px-4 py-3 max-pn-md:flex max-pn-md:flex-wrap max-pn-md:justify-center max-pn-md:gap-2 max-pn-sm:px-2 max-pn-sm:py-2">
      <Relogio titulo={titulo} />
      <div className="flex flex-wrap items-center justify-center gap-2 max-pn-sm:gap-1.5">{centro.map(controle)}</div>
      <div className="flex items-center justify-end gap-2">{direita.map(controle)}</div>
    </footer>
  );
}

/** "08:20 | Nome da call". Atualiza a cada 15 s (a virada do minuto aparece logo). */
function Relogio({ titulo }: { titulo?: string }) {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setAgora(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <p className="flex min-w-0 items-center gap-3 text-[15px] font-medium text-zinc-800 max-pn-md:hidden">
      <span className="tabular-nums">{formatarRelogio(agora)}</span>
      {titulo && (
        <>
          <span className="h-4 w-px bg-zinc-300" aria-hidden />
          <span className="truncate" title={titulo}>{titulo}</span>
        </>
      )}
    </p>
  );
}

/** Compartilhar tela, com as mesmas travas do `RtkScreenShareToggle`: permissão do preset, limite de telas da sala e
 *  navegador bloqueado (abre o aviso do kit). */
function BotaoTela({ meeting }: { meeting: Meeting }) {
  const ligado = useRealtimeKitSelector((m) => m.self.screenShareEnabled);
  const permissao = useRealtimeKitSelector((m) => m.self.mediaPermissions.screenshare);
  const pode = useRealtimeKitSelector((m) => m.self.permissions.canProduceScreenshare === "ALLOWED");
  const limite = useRealtimeKitSelector((m) => m.self.config.maxScreenShareCount);
  const outras = useRealtimeKitSelector((m) => m.participants.active.toArray().filter((p) => p.screenShareEnabled).length);
  const [pedindo, setPedindo] = useState(false);
  const bloqueado = permissao === "DENIED" || permissao === "SYSTEM_DENIED";
  const cheio = !ligado && limite > 0 && outras >= limite;

  async function alternar(e: React.MouseEvent<HTMLButtonElement>) {
    if (bloqueado && !ligado) {
      avisarKit(e.currentTarget, { activePermissionsMessage: { enabled: true, kind: "screenshare" } });
      return;
    }
    if (ligado) {
      void meeting.self.disableScreenShare().catch(() => undefined);
      return;
    }
    if (!pode || cheio || pedindo) return;
    setPedindo(true);
    try {
      await meeting.self.enableScreenShare();
    } catch {
      // cancelou a escolha da tela: nada a fazer
    } finally {
      setPedindo(false);
    }
  }

  const rotulo = ligado ? "Parar de compartilhar" : cheio ? "Já tem o máximo de telas compartilhadas" : bloqueado ? "O navegador bloqueou o compartilhamento de tela" : "Compartilhar tela";
  return (
    <BotaoRedondo
      rotulo={rotulo}
      icone={ligado ? <MonitorX className="vc-icone" /> : <MonitorUp className="vc-icone" />}
      estado={ligado ? "ativo" : "neutro"}
      pressionado={ligado}
      disabled={(!pode && !ligado) || cheio || pedindo}
      ocupado={pedindo}
      onClick={(e) => void alternar(e)}
    />
  );
}

/** Chat: abre e fecha o painel pelo `RtkUiProvider` (o mesmo estado que o "X" do painel fecha) e conta as mensagens
 *  dos outros que chegam com ele fechado. */
function BotaoChat({ meeting, aberto }: { meeting: Meeting; aberto: boolean }) {
  const [naoLidas, setNaoLidas] = useState(0);

  useEffect(() => {
    if (aberto) {
      setNaoLidas(0);
      return;
    }
    const chat = meeting.chat;
    if (!chat) return;
    const aoChegar = ({ action, message }: { action: string; message: { userId?: string } }) => {
      if (action === "add" && message.userId !== meeting.self.userId) setNaoLidas((n) => Math.min(n + 1, 10));
    };
    chat.on("chatUpdate", aoChegar);
    return () => {
      chat.removeListener("chatUpdate", aoChegar);
    };
  }, [aberto, meeting]);

  return (
    <BotaoRedondo
      rotulo={aberto ? "Fechar chat" : "Abrir chat"}
      icone={<MessageSquareText className="vc-icone" />}
      estado={aberto ? "ativo" : "neutro"}
      pressionado={aberto}
      contador={aberto ? 0 : naoLidas}
      onClick={(e) => avisarKit(e.currentTarget, { activeSidebar: !aberto, sidebar: aberto ? undefined : "chat", activeMoreMenu: false })}
    />
  );
}

/** "Mais opções" (⋮): configurações (aparelhos, espelhar vídeo, som de aviso) e, pro anfitrião, silenciar todos. Os
 *  dois abrem os diálogos do kit. */
function BotaoMais({ papel }: { papel: Passe["papel"] }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const fechar = useCallback(() => setAberto(false), []);
  useFecharFora(aberto, caixa, fechar, botao);
  const itens = itensDoMais(papel);

  function abrirDialogo(e: React.MouseEvent<HTMLButtonElement>, estado: Record<string, unknown>) {
    avisarKit(e.currentTarget, estado);
    setAberto(false);
  }

  return (
    <div ref={caixa} className="relative">
      <BotaoRedondo
        ref={botao}
        rotulo="Mais opções"
        icone={<EllipsisVertical className="vc-icone" />}
        estado={aberto ? "ativo" : "neutro"}
        menuAberto={aberto}
        onClick={() => setAberto((a) => !a)}
      />
      {aberto && (
        <div role="menu" aria-label="Mais opções" className="vc-menu right-0 w-64 max-pn-sm:left-1/2 max-pn-sm:right-auto max-pn-sm:-translate-x-1/2">
          {itens.includes("configuracoes") && (
            <button type="button" role="menuitem" className="vc-item" onClick={(e) => abrirDialogo(e, { activeSettings: true, activeMoreMenu: false })}>
              <Settings className="size-5 text-zinc-600" />
              Configurações
            </button>
          )}
          {itens.includes("silenciar_todos") && (
            <button type="button" role="menuitem" className="vc-item" onClick={(e) => abrirDialogo(e, { activeMuteAllConfirmation: true, activeMoreMenu: false })}>
              <MicOff className="size-5 text-zinc-600" />
              Silenciar todos
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Sair: pílula vermelha. Abre a confirmação do kit ("Quer mesmo sair da call?"). */
function BotaoSair() {
  return (
    <BotaoRedondo
      rotulo="Sair da call"
      icone={<PhoneOff className="vc-icone" />}
      className="vc-botao-sair"
      onClick={(e) => avisarKit(e.currentTarget, { activeLeaveConfirmation: true })}
    />
  );
}
