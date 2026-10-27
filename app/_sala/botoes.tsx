"use client";
import { useEffect, type ReactNode, type Ref, type RefObject } from "react";

/** Aparência do botão redondo: cinza (neutro), vermelho cheio (desligado), cor da marca (ativo: chat aberto,
 *  tela compartilhada, gravando, menu aberto). */
export type EstadoBotao = "neutro" | "desligado" | "ativo";

type BotaoRedondoProps = {
  /** Nome da ação: vira o tooltip e o `aria-label` (o botão não tem texto). */
  rotulo: string;
  icone: ReactNode;
  estado?: EstadoBotao;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  ocupado?: boolean;
  pressionado?: boolean;
  /** Abre menu: marca `aria-haspopup` e `aria-expanded`. */
  menuAberto?: boolean;
  /** Bolinha com número (mensagens não lidas). */
  contador?: number;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
};

/** Botão redondo da barra de baixo, igual pra todos (mesmo tamanho, mesmo ícone, mesmos estados). */
export function BotaoRedondo({ rotulo, icone, estado = "neutro", onClick, disabled, ocupado, pressionado, menuAberto, contador, className, ref }: BotaoRedondoProps) {
  return (
    <button
      ref={ref}
      type="button"
      className={`vc-botao ${className ?? ""}`}
      data-estado={estado}
      data-dica={menuAberto ? undefined : rotulo}
      aria-label={rotulo}
      aria-pressed={pressionado}
      aria-haspopup={menuAberto === undefined ? undefined : "menu"}
      aria-expanded={menuAberto}
      aria-busy={ocupado || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {icone}
      {contador !== undefined && contador > 0 && (
        <span className="vc-contador" aria-hidden>
          {contador > 9 ? "9+" : contador}
        </span>
      )}
    </button>
  );
}

/** Fecha o menu ao clicar fora da caixa ou apertar Esc (o Esc devolve o foco pro botão que abriu). */
export function useFecharFora(aberto: boolean, caixa: RefObject<HTMLElement | null>, fechar: () => void, foco?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (caixa.current && !e.composedPath().includes(caixa.current)) fechar();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      fechar();
      foco?.current?.focus();
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto, caixa, fechar, foco]);
}

/** Avisa o `RtkUiProvider` (mesmo evento que os botões do kit mandam): abre o chat, a confirmação de sair, as
 *  configurações, o "silenciar todos" e o aviso de permissão bloqueada. O elemento tem que estar dentro do provider. */
export function avisarKit(origem: EventTarget | null | undefined, estado: Record<string, unknown>) {
  origem?.dispatchEvent(new CustomEvent("rtkStateUpdate", { detail: estado, bubbles: true, composed: true }));
}
