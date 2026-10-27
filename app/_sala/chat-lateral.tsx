"use client";
import { X } from "lucide-react";
import { RtkChat } from "@cloudflare/realtimekit-react-ui";
import type { Meeting } from "./tipos";

/**
 * Painel do chat à direita, que empurra o palco (360 px no computador, tela cheia no celular). O `RtkChat` já traz
 * mensagens fixadas, o seletor "Todos"/pessoa, anexo, imagem e emoji, conforme o que o preset deixa.
 * Fechar avisa o `RtkUiProvider` (mesmo evento que o `RtkChatToggle` usa), pra o botão da barra desmarcar junto.
 */
export function ChatLateral({ meeting }: { meeting: Meeting }) {
  function fechar(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.dispatchEvent(
      new CustomEvent("rtkStateUpdate", { detail: { activeSidebar: false }, bubbles: true, composed: true }),
    );
  }

  return (
    <aside
      aria-label="Chat"
      className="vc-chat flex w-[360px] shrink-0 flex-col border-l border-zinc-100 bg-white max-pn-sm:absolute max-pn-sm:inset-0 max-pn-sm:z-40 max-pn-sm:w-full max-pn-sm:border-l-0"
    >
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <h2 className="text-base font-semibold text-zinc-900">Chat</h2>
        <button
          type="button"
          onClick={fechar}
          aria-label="Fechar chat"
          className="-mr-2 grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
        >
          <X className="size-4" />
        </button>
      </div>
      <RtkChat meeting={meeting} className="min-h-0 flex-1" />
    </aside>
  );
}
