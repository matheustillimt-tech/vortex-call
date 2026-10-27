"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Video } from "lucide-react";
import { BotaoCopiar } from "../_componentes/copiar";
import { criarEAbrirReuniao } from "../_componentes/reuniao-agora";
import { useToast } from "../_componentes/toast";
import { Botao, BotaoLink, estiloInput } from "../_componentes/ui";

/** "Nova reunião" com título opcional: cria e abre a sala na mesma aba. */
export function NovaReuniao() {
  const toast = useToast();
  const [titulo, setTitulo] = useState("");
  const [criando, setCriando] = useState(false);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setCriando(true);
    const erro = await criarEAbrirReuniao(titulo.trim() || undefined);
    if (erro) {
      toast.erro(erro);
      setCriando(false);
    }
  }

  return (
    <form onSubmit={criar} className="flex flex-wrap items-center gap-2">
      <input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        maxLength={100}
        placeholder="Título (opcional)"
        aria-label="Título da reunião (opcional)"
        className={`${estiloInput} w-56`}
      />
      <Botao type="submit" carregando={criando} icone={<Video aria-hidden />}>Nova reunião</Botao>
    </form>
  );
}

/** Ações da linha de uma reunião ativa: entrar, copiar o link e encerrar pra todo mundo. */
export function AcoesReuniao({ codigo, link }: { codigo: string; link: string }) {
  const toast = useToast();
  const router = useRouter();
  const [encerrando, setEncerrando] = useState(false);

  async function encerrar() {
    const ok = await toast.confirmar({
      titulo: "Encerrar reunião?",
      descricao: "Isso tira todo mundo da sala e o link para de funcionar.",
      confirmar: "Encerrar",
      perigo: true,
    });
    if (!ok) return;
    setEncerrando(true);
    try {
      const r = await fetch(`/api/reunioes/encerrar/${codigo}`, { method: "POST" });
      if (r.ok || r.status === 409) toast.sucesso("Reunião encerrada.");
      else toast.erro("Não deu para encerrar a reunião.", "Tente de novo.");
    } catch {
      toast.erro("Não deu para encerrar a reunião.", "Tente de novo.");
    }
    setEncerrando(false);
    router.refresh();
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <BotaoLink href={`/r/${codigo}`} variante="secundario" tamanho="pequeno">Entrar</BotaoLink>
      <BotaoCopiar texto={link} />
      <Botao variante="perigo" tamanho="pequeno" carregando={encerrando} onClick={() => void encerrar()}>Encerrar</Botao>
    </div>
  );
}
