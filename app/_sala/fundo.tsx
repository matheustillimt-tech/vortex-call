"use client";
import { useCallback, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";
import type VideoBGAddon from "@cloudflare/realtimekit-ui-addons/video-background";
import { BotaoRedondo, useFecharFora } from "./botoes";
import type { Meeting } from "./tipos";

/** Imagens públicas da própria Cloudflare (as mesmas do addon), servidas com CORS liberado. */
const IMAGENS = [
  "https://rtk-assets.realtime.cloudflare.com/backgrounds/bg_1.jpg",
  "https://rtk-assets.realtime.cloudflare.com/backgrounds/bg_2.jpg",
  "https://rtk-assets.realtime.cloudflare.com/backgrounds/bg_3.jpg",
];

/** O addon põe a caixa de diálogo dele (que não usamos) dentro deste elemento escondido. */
const ID_ADDON = "vc-fundo-addon";

type Escolha = "nenhum" | "desfoque" | string;
type Estado = "fechado" | "carregando" | "pronto" | "sem_suporte";

/**
 * Botão "Fundo" da barra (redondo, marcado enquanto um fundo está aplicado) e o menu dele: "Sem fundo", "Desfocar" e 3 imagens. Usa o addon de fundo do
 * `@cloudflare/realtimekit-ui-addons` pela API dele (`applyBlurBackground`, `applyVirtualBackground`,
 * `removeBackground`), sem a caixa de diálogo própria do addon. Os dois pacotes (~230 KB) só carregam quando o menu
 * abre pela primeira vez.
 */
export function BotaoFundo({ meeting }: { meeting: Meeting }) {
  const [aberto, setAberto] = useState(false);
  const [estado, setEstado] = useState<Estado>("fechado");
  const [escolha, setEscolha] = useState<Escolha>("nenhum");
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const addon = useRef<VideoBGAddon | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  const botao = useRef<HTMLButtonElement>(null);
  const fechar = useCallback(() => setAberto(false), []);
  useFecharFora(aberto, caixa, fechar, botao);

  async function preparar() {
    if (estado !== "fechado") return;
    setEstado("carregando");
    try {
      const [{ default: Transformador }, { default: Addon }] = await Promise.all([
        import("@cloudflare/realtimekit-virtual-background"),
        import("@cloudflare/realtimekit-ui-addons/video-background"),
      ]);
      if (!Transformador.isSupported()) {
        setEstado("sem_suporte");
        return;
      }
      addon.current = await Addon.init({ meeting, images: IMAGENS, modes: ["blur", "virtual"], selector: `#${ID_ADDON}` });
      setEstado("pronto");
    } catch {
      setEstado("fechado");
      setErro("Não deu para carregar os fundos. Tente de novo.");
    }
  }

  function alternar() {
    const abrir = !aberto;
    setAberto(abrir);
    if (abrir) {
      setErro(null);
      void preparar();
    }
  }

  async function aplicar(nova: Escolha) {
    const a = addon.current;
    if (!a || aplicando || nova === escolha) return;
    setAplicando(true);
    setErro(null);
    try {
      const r =
        nova === "nenhum" ? await a.removeBackground() : nova === "desfoque" ? await a.applyBlurBackground() : await a.applyVirtualBackground(nova);
      if (r.isSuccessful) setEscolha(nova);
      else if (r.code === "UNSUPPORTED_BROWSER") setEstado("sem_suporte");
      else setErro("Não deu para trocar o fundo. Tente de novo.");
    } catch {
      setErro("Não deu para trocar o fundo. Tente de novo.");
    } finally {
      setAplicando(false);
    }
  }

  const desabilitado = estado !== "pronto" || aplicando;

  return (
    <div ref={caixa} className="relative">
      <BotaoRedondo
        ref={botao}
        rotulo="Fundo"
        icone={<ImageIcon className="vc-icone" />}
        estado={aberto || escolha !== "nenhum" ? "ativo" : "neutro"}
        menuAberto={aberto}
        onClick={alternar}
      />
      <div id={ID_ADDON} hidden />
      {aberto && (
        <div
          role="menu"
          aria-label="Fundo"
          className="vc-menu vc-menu-caixa left-1/2 w-72 -translate-x-1/2"
        >
          <p className="mb-2 font-semibold">Fundo</p>
          {estado === "sem_suporte" ? (
            <p className="text-zinc-500">Este navegador não aceita trocar o fundo. Tente pelo Chrome ou Edge no computador.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <OpcaoTexto rotulo="Sem fundo" ativa={escolha === "nenhum"} desabilitada={desabilitado} aoEscolher={() => aplicar("nenhum")} />
                <OpcaoTexto rotulo="Desfocar" ativa={escolha === "desfoque"} desabilitada={desabilitado} aoEscolher={() => aplicar("desfoque")} />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {IMAGENS.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    role="menuitemradio"
                    aria-checked={escolha === url}
                    aria-label={`Imagem ${i + 1}`}
                    disabled={desabilitado}
                    onClick={() => aplicar(url)}
                    className={`aspect-video overflow-hidden rounded-lg border-2 disabled:opacity-50 ${escolha === url ? "border-marca" : "border-transparent hover:border-zinc-300"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- miniatura de imagem externa */}
                    <img src={url} alt="" className="size-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
              {estado === "carregando" && <p className="mt-2 text-xs text-zinc-500">Carregando…</p>}
              {aplicando && <p className="mt-2 text-xs text-zinc-500">Aplicando…</p>}
            </>
          )}
          {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}
        </div>
      )}
    </div>
  );
}

function OpcaoTexto(props: { rotulo: string; ativa: boolean; desabilitada: boolean; aoEscolher: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.ativa}
      disabled={props.desabilitada}
      onClick={props.aoEscolher}
      className={`rounded-lg border px-3 py-2 text-left font-medium disabled:opacity-50 ${props.ativa ? "border-marca text-marca" : "border-zinc-200 hover:bg-zinc-50"}`}
    >
      {props.rotulo}
    </button>
  );
}
