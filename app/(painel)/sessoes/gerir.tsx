"use client";
// Horários pelo admin ou pelo responsável da agenda: cancelar sessão, mudar vagas e parar repetição. Quem decide de
// verdade é a server action (confere admin/responsável e os inscritos na hora); aqui só mostra e avisa.
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../_componentes/modal";
import { useToast } from "../_componentes/toast";
import { AjudaInfo, Botao, CampoTexto } from "../_componentes/ui";
import { alterarVagas, cancelarSessao, pararRepeticao, type Resultado } from "./actions";

/** Botão "Cancelar sessão". `bloqueio` = motivo pra não deixar (ex.: membro e sessão com inscritos): fica desativado
 *  com o motivo ao lado. */
export function BotaoCancelarSessao({ id, inscritos, bloqueio }: { id: string; inscritos: number; bloqueio?: string }) {
  const toast = useToast();
  const router = useRouter();
  const [cancelando, setCancelando] = useState(false);

  if (bloqueio) {
    return (
      <span className="inline-flex items-center gap-1">
        <Botao variante="perigo" disabled title={bloqueio}>Cancelar sessão</Botao>
        <AjudaInfo texto={bloqueio} lado="baixo" />
      </span>
    );
  }

  async function cancelar() {
    const aviso = inscritos > 0 ? ` As ${inscritos} inscrições agendadas serão canceladas.` : "";
    if (!(await toast.confirmar({ titulo: "Cancelar esta sessão?", descricao: `Ninguém mais consegue agendar nela.${aviso}`, confirmar: "Cancelar sessão", cancelar: "Voltar", perigo: true }))) return;
    setCancelando(true);
    try {
      const r = await cancelarSessao(id);
      if (r.erro) toast.erro("Não deu para cancelar.", r.erro);
      else {
        toast.sucesso("Sessão cancelada.");
        router.refresh();
      }
    } catch (e) {
      toast.erro("Não deu para cancelar.", e instanceof Error ? e.message : undefined);
    } finally {
      setCancelando(false);
    }
  }

  return <Botao variante="perigo" carregando={cancelando} onClick={cancelar}>Cancelar sessão</Botao>;
}

/** Botão "Vagas" que abre o modal pra mudar as vagas da sessão (nunca abaixo dos inscritos ativos). */
export function EditarVagas({ id, vagas, inscritos }: { id: string; vagas: number; inscritos: number }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [estado, acao, salvando] = useActionState<Resultado, FormData>(alterarVagas.bind(null, id), {});
  useEffect(() => {
    if (estado.ok) {
      setAberto(false);
      router.refresh();
    }
  }, [estado, router]);
  return (
    <>
      <Botao variante="secundario" onClick={() => setAberto(true)}>Vagas: {inscritos} / {vagas}</Botao>
      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo="Vagas da sessão" descricao={`${inscritos} ${inscritos === 1 ? "inscrito ativo" : "inscritos ativos"}: as vagas não podem ficar abaixo disso.`}>
        <form action={acao} className="grid gap-3">
          <CampoTexto rotulo="Vagas" name="vagas" type="number" min={Math.max(1, inscritos)} max={500} defaultValue={vagas} required />
          <Botao type="submit" carregando={salvando}>Salvar</Botao>
          {estado.erro && <p className="text-sm text-erro">{estado.erro}</p>}
        </form>
      </Modal>
    </>
  );
}

/** "Parar" numa repetição: as sessões já criadas ficam; só não nascem novas. */
export function BotaoPararRepeticao({ id }: { id: string }) {
  const toast = useToast();
  const router = useRouter();
  const [parando, setParando] = useState(false);
  async function parar() {
    if (!(await toast.confirmar({ titulo: "Parar este horário?", descricao: "As sessões já criadas continuam; só não aparecem sessões novas.", confirmar: "Parar", cancelar: "Voltar", perigo: true }))) return;
    setParando(true);
    try {
      const r = await pararRepeticao(id);
      if (r.erro) toast.erro("Não deu para parar.", r.erro);
      else {
        toast.sucesso("Horário parado.");
        router.refresh();
      }
    } finally {
      setParando(false);
    }
  }
  return <Botao variante="secundario" tamanho="pequeno" carregando={parando} onClick={parar}>Parar</Botao>;
}
