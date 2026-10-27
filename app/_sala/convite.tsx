"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { BotaoRedondo, useFecharFora } from "./botoes";
import { copiarTexto } from "./copiar-texto";

type Aviso = { tipo: "copiado" } | { tipo: "erro"; texto: string } | { tipo: "link"; link: string };

/** "Copiar link de convidado" do anfitrião (sala da equipe de uma sessão): pede o link a
 *  `POST /api/sala/link-convidado/{sessao}` (o mesmo em todo clique), copia e avisa "Link de convidado copiado". Se o
 *  navegador não deixar copiar, mostra o link numa caixinha com "Copiar". Quem abre o link entra na hora como
 *  participante, sem login e sem inscrição, mesmo com a sessão cheia. */
export function BotaoConvite({ sessaoId }: { sessaoId: string }) {
  const [pedindo, setPedindo] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const fechar = useCallback(() => setAviso(null), []);
  useFecharFora(aviso?.tipo === "link", caixa, fechar, botao);

  // "Copiado" e erro somem sozinhos; a caixinha com o link fica até a pessoa copiar ou clicar fora.
  useEffect(() => {
    if (!aviso || aviso.tipo === "link") return;
    const t = window.setTimeout(() => setAviso(null), aviso.tipo === "copiado" ? 2500 : 5000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  async function pegarECopiar() {
    if (pedindo) return;
    setPedindo(true);
    setAviso(null);
    try {
      const r = await fetch(`/api/sala/link-convidado/${sessaoId}`, { method: "POST" });
      const j = (await r.json().catch(() => null)) as { link?: string; erro?: string } | null;
      if (!r.ok || !j?.link) {
        setAviso({ tipo: "erro", texto: j?.erro ?? "Não deu para gerar o link. Tente de novo." });
        return;
      }
      setAviso((await copiarTexto(j.link)) ? { tipo: "copiado" } : { tipo: "link", link: j.link });
    } catch {
      setAviso({ tipo: "erro", texto: "Sem conexão. Tente de novo." });
    } finally {
      setPedindo(false);
    }
  }

  async function copiarDaCaixa(link: string) {
    if (await copiarTexto(link)) setAviso({ tipo: "copiado" });
  }

  return (
    <div ref={caixa} className="relative">
      <BotaoRedondo
        ref={botao}
        rotulo="Copiar link de convidado"
        icone={pedindo ? <Loader2 className="vc-icone animate-spin" /> : <Link2 className="vc-icone" />}
        ocupado={pedindo}
        disabled={pedindo}
        onClick={() => void pegarECopiar()}
      />
      {aviso?.tipo === "copiado" && (
        <p role="status" className="absolute bottom-full left-1/2 z-50 mb-12 w-max -translate-x-1/2 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-white shadow-lg">
          Link de convidado copiado
        </p>
      )}
      {aviso?.tipo === "erro" && (
        <p role="alert" className="absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-2 text-center text-xs text-erro shadow-lg">
          {aviso.texto}
        </p>
      )}
      {aviso?.tipo === "link" && (
        <div role="dialog" aria-label="Link de convidado" className="vc-menu vc-menu-caixa left-1/2 w-80 -translate-x-1/2">
          <p className="mb-2 text-xs text-zinc-600">Manda pro convidado. Ele entra na hora, sem login e sem ocupar vaga.</p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={aviso.link}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-xs text-zinc-800"
            />
            <button
              type="button"
              onClick={() => void copiarDaCaixa(aviso.link)}
              className="shrink-0 rounded-md bg-marca px-3 py-1.5 text-xs font-medium text-white hover:bg-marca-escura"
            >
              Copiar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
