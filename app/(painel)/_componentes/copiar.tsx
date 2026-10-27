"use client";
// Copiar com toast "Link copiado!": botão de ícone das tabelas, botão com texto e a caixa de link.
import { Check, Copy, Link2 } from "lucide-react";
import { useState } from "react";
import { copiarTexto } from "@/app/_sala/copiar-texto";
import { useToast } from "./toast";
import { estiloBotao, estiloBotaoIcone } from "./ui";

export function useCopiar() {
  const toast = useToast();
  return async function copiar(texto: string, aviso = "Link copiado!") {
    if (await copiarTexto(texto)) {
      toast.sucesso(aviso);
      return true;
    }
    toast.erro("Não deu para copiar.", "Selecione o texto e copie na mão.");
    return false;
  };
}

/** `icone` = botão 50×40 da tabela (ícone de link na cor de marca); `botao` = botão secundário "Copiar". */
export function BotaoCopiar({ texto, rotulo = "Copiar link", formato = "icone", aviso }: { texto: string; rotulo?: string; formato?: "icone" | "botao"; aviso?: string }) {
  const copiar = useCopiar();
  const [ok, setOk] = useState(false);
  async function clicar() {
    if (await copiar(texto, aviso)) {
      setOk(true);
      window.setTimeout(() => setOk(false), 2000);
    }
  }
  if (formato === "botao") {
    return (
      <button type="button" onClick={() => void clicar()} className={estiloBotao("secundario")}>
        {ok ? <Check aria-hidden /> : <Copy aria-hidden />}
        {ok ? "Copiado!" : "Copiar"}
      </button>
    );
  }
  return (
    <button type="button" aria-label={rotulo} title={rotulo} onClick={() => void clicar()} className={estiloBotaoIcone("tabela", "marca")}>
      {ok ? <Check size={20} aria-hidden /> : <Link2 size={20} aria-hidden />}
    </button>
  );
}
