"use client";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const LARGURA = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" } as const;

/**
 * Modal do painel (no estilo do Dialog do shadcn/ui): overlay preto 80%, caixa branca raio 8, padding 24, título 18/600,
 * descrição 14 cinza, X no canto. Fecha no X, no Esc e no clique fora (a não ser com `travado`).
 * O foco entra no primeiro campo (ou na caixa) ao abrir e volta pra quem abriu ao fechar.
 */
export function Modal({ aberto, aoFechar, titulo, descricao, children, rodape, largura = "md", travado = false }: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  children?: React.ReactNode;
  /** Botões alinhados à direita (no celular, empilhados). */
  rodape?: React.ReactNode;
  largura?: keyof typeof LARGURA;
  /** Não fecha no Esc nem no clique fora (ex.: enquanto salva). */
  travado?: boolean;
}) {
  const idTitulo = useId();
  const idDescricao = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;

  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const alvo = caixa.current?.querySelector<HTMLElement>("[autofocus], input:not([type=hidden]), select, textarea, button:not([data-fechar])") ?? caixa.current;
    alvo?.focus();

    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape" && !travado) fechar.current();
      if (e.key !== "Tab" || !caixa.current) return;
      // Prende o Tab dentro do modal.
      const focaveis = [...caixa.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("keydown", tecla);
      document.body.style.overflow = overflow;
      anterior?.focus?.();
    };
  }, [aberto, travado]);

  if (!aberto || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ animation: "gw-aparecer 150ms ease-out" }}>
      <div className="absolute inset-0 bg-overlay" aria-hidden onClick={() => !travado && aoFechar()} />
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={descricao ? idDescricao : undefined}
        tabIndex={-1}
        className={`relative z-10 flex max-h-[calc(100dvh-2rem)] w-full ${LARGURA[largura]} flex-col gap-4 overflow-y-auto rounded-lg border border-linha bg-superficie p-6 text-sm text-texto shadow-lg outline-none max-pn-sm:p-5`}
      >
        <div className="space-y-1.5 pr-6">
          <h2 id={idTitulo} className="text-lg font-semibold leading-none tracking-tight text-titulo">
            {titulo}
          </h2>
          {descricao && (
            <p id={idDescricao} className="whitespace-pre-line text-sm text-texto-3">
              {descricao}
            </p>
          )}
        </div>
        {children}
        {rodape && <div className="flex flex-col-reverse gap-2 pn-sm:flex-row pn-sm:justify-end">{rodape}</div>}
        <button
          type="button"
          data-fechar
          aria-label="Fechar"
          onClick={() => !travado && aoFechar()}
          className="absolute right-4 top-4 rounded-sm text-texto-3 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>,
    document.body,
  );
}
