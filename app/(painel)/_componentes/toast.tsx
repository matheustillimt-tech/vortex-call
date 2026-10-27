"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { Modal } from "./modal";
import { estiloBotao } from "./ui";

export type TipoToast = "sucesso" | "erro" | "aviso" | "info";
export type Toast = { titulo: React.ReactNode; descricao?: React.ReactNode; tipo?: TipoToast; /** ms; padrão 5000 (erro 8000). */ duracao?: number };

export type OpcoesConfirmar = {
  titulo?: React.ReactNode;
  descricao?: React.ReactNode;
  /** Texto do botão de confirmar. Padrão "Confirmar" (com `perigo`, "Excluir"). */
  confirmar?: string;
  cancelar?: string;
  /** Botão de confirmar vermelho (excluir, apagar, encerrar). */
  perigo?: boolean;
};

type ApiToast = {
  /** Mostra um toast no canto de baixo à direita. */
  mostrar: (t: Toast) => void;
  sucesso: (titulo: React.ReactNode, descricao?: React.ReactNode) => void;
  erro: (titulo: React.ReactNode, descricao?: React.ReactNode) => void;
  aviso: (titulo: React.ReactNode, descricao?: React.ReactNode) => void;
  /** No lugar do `window.confirm`: abre o modal e resolve `true` se a pessoa confirmar. */
  confirmar: (opcoes?: OpcoesConfirmar | string) => Promise<boolean>;
};

const Contexto = createContext<ApiToast | null>(null);

const ICONE: Record<TipoToast, { Icone: typeof Info; cor: string }> = {
  sucesso: { Icone: CircleCheck, cor: "text-ok" },
  erro: { Icone: CircleAlert, cor: "text-erro" },
  aviso: { Icone: TriangleAlert, cor: "text-aviso" },
  info: { Icone: Info, cor: "text-marca" },
};

type ToastVivo = Toast & { id: number };
type Pedido = { opcoes: OpcoesConfirmar; resolver: (ok: boolean) => void };

/** Fica no layout do painel. Dá `useToast()` (toasts + `confirmar()`) pra qualquer componente cliente de dentro. */
export function ProvedorToast({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastVivo[]>([]);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const proximo = useRef(1);

  const fechar = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const mostrar = useCallback(
    (t: Toast) => {
      const id = proximo.current++;
      setToasts((lista) => [...lista.slice(-3), { ...t, id }]);
      window.setTimeout(() => fechar(id), t.duracao ?? (t.tipo === "erro" ? 8000 : 5000));
    },
    [fechar],
  );

  const confirmar = useCallback(
    (opcoes?: OpcoesConfirmar | string) =>
      new Promise<boolean>((resolver) => {
        const o = typeof opcoes === "string" ? { descricao: opcoes } : (opcoes ?? {});
        setPedido({ opcoes: o, resolver });
      }),
    [],
  );

  const api = useMemo<ApiToast>(
    () => ({
      mostrar,
      sucesso: (titulo, descricao) => mostrar({ titulo, descricao, tipo: "sucesso" }),
      erro: (titulo, descricao) => mostrar({ titulo, descricao, tipo: "erro" }),
      aviso: (titulo, descricao) => mostrar({ titulo, descricao, tipo: "aviso" }),
      confirmar,
    }),
    [mostrar, confirmar],
  );

  function responder(ok: boolean) {
    pedido?.resolver(ok);
    setPedido(null);
  }

  const o = pedido?.opcoes;
  return (
    <Contexto.Provider value={api}>
      {children}

      <Modal
        aberto={!!pedido}
        aoFechar={() => responder(false)}
        largura="sm"
        titulo={o?.titulo ?? (o?.perigo ? "Você está prestes a excluir um item!" : "Tem certeza?")}
        descricao={o?.descricao}
        rodape={
          <>
            <button type="button" className={estiloBotao("secundario")} onClick={() => responder(false)}>
              {o?.cancelar ?? "Cancelar"}
            </button>
            <button type="button" className={estiloBotao(o?.perigo ? "perigo" : "principal")} onClick={() => responder(true)}>
              {o?.confirmar ?? (o?.perigo ? "Excluir" : "Confirmar")}
            </button>
          </>
        }
      />

      <ol
        aria-live="polite"
        className="pointer-events-none fixed bottom-0 right-0 z-[60] flex max-h-screen w-full flex-col gap-2 p-4 pn-sm:max-w-[420px]"
      >
        {toasts.map((t) => {
          const { Icone, cor } = ICONE[t.tipo ?? "info"];
          return (
            <li
              key={t.id}
              role={t.tipo === "erro" ? "alert" : "status"}
              className="pointer-events-auto relative flex w-full items-start gap-3 rounded-md border border-linha bg-superficie p-4 pr-8 text-texto shadow-lg"
              style={{ animation: "gw-entrar-toast 180ms ease-out" }}
            >
              <Icone size={20} className={`mt-px shrink-0 ${cor}`} aria-hidden />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold">{t.titulo}</p>
                {t.descricao && <p className="text-sm text-texto-3">{t.descricao}</p>}
              </div>
              <button type="button" aria-label="Fechar aviso" onClick={() => fechar(t.id)} className="absolute right-2 top-2 rounded-md p-1 text-texto-3 hover:text-texto">
                <X size={16} aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>
    </Contexto.Provider>
  );
}

/** Toasts e `confirmar()` do painel. Fora do `ProvedorToast` (ex.: editor de páginas), cai no `window.alert`/`confirm`. */
export function useToast(): ApiToast {
  const api = useContext(Contexto);
  if (api) return api;
  const texto = (titulo: React.ReactNode, descricao?: React.ReactNode) => [titulo, descricao].filter((x) => typeof x === "string").join("\n");
  return {
    mostrar: (t) => window.alert(texto(t.titulo, t.descricao)),
    sucesso: (titulo, descricao) => window.alert(texto(titulo, descricao)),
    erro: (titulo, descricao) => window.alert(texto(titulo, descricao)),
    aviso: (titulo, descricao) => window.alert(texto(titulo, descricao)),
    confirmar: async (opcoes) => window.confirm(typeof opcoes === "string" ? opcoes : texto(opcoes?.titulo ?? "Tem certeza?", opcoes?.descricao)),
  };
}

/** Atalho: `const confirmar = useConfirmar(); if (!(await confirmar({ descricao: "…", perigo: true }))) return;` */
export function useConfirmar() {
  return useToast().confirmar;
}
