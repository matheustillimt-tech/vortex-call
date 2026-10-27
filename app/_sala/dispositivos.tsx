"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeKitSelector } from "@cloudflare/realtimekit-react";
import { Check, ChevronUp, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { dispositivosUnicos, estadoMidia, rotuloDispositivo, textoSemDispositivo, type TipoDispositivo } from "./barra-regras";
import { avisarKit, BotaoRedondo, useFecharFora } from "./botoes";
import type { Meeting } from "./tipos";

type Secao = { tipo: TipoDispositivo; titulo: string; lista: MediaDeviceInfo[] };
type Carga = "fechado" | "carregando" | "pronto";

/**
 * Microfone ou câmera: pílula com a setinha (^) à esquerda, que abre o menu de aparelhos, e o
 * botão redondo de ligar/desligar à direita (vermelho quando desligado). Menu do microfone: seções "Microfone" e
 * "Alto-falante" (esta só quando o navegador deixa escolher a saída de som); da câmera: "Câmera". O aparelho em uso
 * fica marcado e a troca vale na hora (`meeting.self.setDevice`). Mesmo comportamento dos botões do kit: bloqueado
 * pelo navegador abre o aviso de permissão; sem permissão no preset, o botão fica desabilitado.
 */
export function BotaoMidia({ meeting, tipo }: { meeting: Meeting; tipo: "audio" | "video" }) {
  const audio = tipo === "audio";
  const ligadoAgora = useRealtimeKitSelector((m) => (audio ? m.self.audioEnabled : m.self.videoEnabled));
  const permissao = useRealtimeKitSelector((m) => (audio ? m.self.mediaPermissions.audio : m.self.mediaPermissions.video));
  const pode = useRealtimeKitSelector((m) =>
    audio ? m.self.permissions.canProduceAudio === "ALLOWED" : m.self.permissions.canProduceVideo === "ALLOWED",
  );
  const estado = estadoMidia(tipo, ligadoAgora, permissao);
  const nome = audio ? "microfone" : "câmera";

  const [aberto, setAberto] = useState(false);
  const [carga, setCarga] = useState<Carga>("fechado");
  const [secoes, setSecoes] = useState<Secao[]>([]);
  const [atuais, setAtuais] = useState<Partial<Record<TipoDispositivo, string>>>({});
  const [trocando, setTrocando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const seta = useRef<HTMLButtonElement>(null);

  const fechar = useCallback(() => setAberto(false), []);
  useFecharFora(aberto, caixa, fechar, seta);

  const lerAtuais = useCallback(() => {
    try {
      const d = meeting.self.getCurrentDevices();
      setAtuais({ audio: d.audio?.deviceId, video: d.video?.deviceId, speaker: d.speaker?.deviceId });
    } catch {
      setAtuais({});
    }
  }, [meeting]);

  const carregar = useCallback(async () => {
    const self = meeting.self;
    // O navegador pode não deixar listar (ou escolher) a saída de som: sem lista, a seção não aparece.
    const seguro = (p: () => Promise<MediaDeviceInfo[]>) => p().catch(() => [] as MediaDeviceInfo[]);
    if (audio) {
      const [mics, falantes] = await Promise.all([seguro(() => self.getAudioDevices()), seguro(() => self.getSpeakerDevices())]);
      const lista: Secao[] = [{ tipo: "audio", titulo: "Microfone", lista: dispositivosUnicos(mics) }];
      if (falantes.length > 0) lista.push({ tipo: "speaker", titulo: "Alto-falante", lista: dispositivosUnicos(falantes) });
      setSecoes(lista);
    } else {
      setSecoes([{ tipo: "video", titulo: "Câmera", lista: dispositivosUnicos(await seguro(() => self.getVideoDevices())) }]);
    }
    lerAtuais();
    setCarga("pronto");
  }, [meeting, audio, lerAtuais]);

  // Aparelho ligado/desligado no computador ou trocado por outro lugar (configurações do kit): atualiza o menu aberto.
  useEffect(() => {
    if (!aberto) return;
    const aoMudarLista = () => void carregar();
    meeting.self.on("deviceListUpdate", aoMudarLista);
    meeting.self.on("deviceUpdate", lerAtuais);
    return () => {
      meeting.self.removeListener("deviceListUpdate", aoMudarLista);
      meeting.self.removeListener("deviceUpdate", lerAtuais);
    };
  }, [aberto, meeting, carregar, lerAtuais]);

  function alternarMenu() {
    const abrir = !aberto;
    setAberto(abrir);
    if (abrir) {
      setErro(null);
      if (carga === "fechado") setCarga("carregando");
      void carregar();
    }
  }

  async function escolher(d: MediaDeviceInfo, t: TipoDispositivo) {
    if (trocando || atuais[t] === d.deviceId) return;
    setTrocando(true);
    setErro(null);
    try {
      await meeting.self.setDevice(d);
      setAtuais((a) => ({ ...a, [t]: d.deviceId }));
    } catch {
      setErro("Não deu para trocar o aparelho. Tente de novo.");
    } finally {
      setTrocando(false);
      lerAtuais();
    }
  }

  function alternarMidia(e: React.MouseEvent<HTMLButtonElement>) {
    if (estado.bloqueado) {
      avisarKit(e.currentTarget, { activePermissionsMessage: { enabled: true, kind: tipo } });
      return;
    }
    if (!pode) return;
    const self = meeting.self;
    const pedido = audio
      ? self.audioEnabled ? self.disableAudio() : self.enableAudio()
      : self.videoEnabled ? self.disableVideo() : self.enableVideo();
    void Promise.resolve(pedido).catch(() => undefined);
  }

  const semNomes = carga === "pronto" && secoes.every((s) => s.lista.every((d) => !d.label.trim()));
  const IconeLigado = audio ? Mic : Video;
  const IconeDesligado = audio ? MicOff : VideoOff;

  return (
    <div ref={caixa} className="vc-dividido relative">
      <button
        ref={seta}
        type="button"
        className="vc-seta"
        data-dica={aberto ? undefined : audio ? "Configurações de áudio" : "Configurações de vídeo"}
        aria-label={audio ? "Escolher microfone e alto-falante" : "Escolher câmera"}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={alternarMenu}
      >
        <ChevronUp className={`size-4 transition-transform ${aberto ? "rotate-180" : ""}`} strokeWidth={2.25} />
      </button>
      <BotaoRedondo
        rotulo={pode ? estado.dica : `Sem permissão para usar ${audio ? "o" : "a"} ${nome}`}
        icone={estado.ligado ? <IconeLigado className="vc-icone" /> : <IconeDesligado className="vc-icone" />}
        estado={estado.ligado ? "neutro" : "desligado"}
        pressionado={estado.ligado}
        disabled={!pode && !estado.bloqueado}
        onClick={alternarMidia}
      />
      {aberto && (
        <div role="menu" aria-label={audio ? "Microfone e alto-falante" : "Câmera"} className="vc-menu left-0 w-80">
          {carga !== "pronto" ? (
            <p className="px-4 py-3 text-zinc-500">Carregando…</p>
          ) : (
            secoes.map((s) => (
              <div key={s.tipo} role="group" aria-label={s.titulo} className="py-1">
                <p className="px-4 pb-1 pt-2 text-xs font-semibold text-zinc-500">{s.titulo}</p>
                {s.lista.length === 0 ? (
                  <p className="px-4 py-2 text-zinc-500">{textoSemDispositivo(s.tipo)}</p>
                ) : (
                  s.lista.map((d, i) => {
                    const atual = atuais[s.tipo] === d.deviceId;
                    return (
                      <button
                        key={d.deviceId}
                        type="button"
                        role="menuitemradio"
                        aria-checked={atual}
                        disabled={trocando}
                        onClick={() => void escolher(d, s.tipo)}
                        className="vc-item"
                      >
                        <span className="grid size-5 shrink-0 place-items-center">{atual && <Check className="size-4 text-[var(--vc-marca)]" strokeWidth={2.5} />}</span>
                        <span className="min-w-0 flex-1 truncate">{rotuloDispositivo(d, i, s.tipo)}</span>
                      </button>
                    );
                  })
                )}
              </div>
            ))
          )}
          {semNomes && <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">Ligue {audio ? "o microfone" : "a câmera"} para ver o nome dos aparelhos.</p>}
          {erro && <p role="alert" className="px-4 py-2 text-xs text-red-600">{erro}</p>}
        </div>
      )}
    </div>
  );
}
