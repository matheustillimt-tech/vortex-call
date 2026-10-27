"use client";
// "Trocar horário" na linha do inscrito (página da sessão): escolhe outra sessão da mesma agenda e a pessoa é movida,
// com o mesmo link da sala. Quem confere permissão e vaga é a server action; aqui só mostra as opções.
import { CalendarClock } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../_componentes/modal";
import { useToast } from "../_componentes/toast";
import { Botao, CampoSelecao, estiloBotaoIcone } from "../_componentes/ui";
import type { SessaoOpcao } from "../agendas/agendar-pessoa";
import { trocarHorarioAction, type Resultado } from "./actions";

export function TrocarHorario({ inscricaoId, nome, sessaoAtual, sessoes }: { inscricaoId: string; nome: string; sessaoAtual: string; sessoes: SessaoOpcao[] }) {
  const [aberto, setAberto] = useState(false);
  const [chave, setChave] = useState(0);
  return (
    <>
      <button type="button" aria-label="Trocar horário" title="Trocar horário" onClick={() => { setChave((c) => c + 1); setAberto(true); }} className={estiloBotaoIcone("tabela", "marca")}>
        <CalendarClock size={20} aria-hidden />
      </button>
      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo="Trocar horário" descricao={`${nome} vai pro horário escolhido e recebe a confirmação no WhatsApp. O link da sala continua o mesmo.`}>
        <Formulario key={chave} inscricaoId={inscricaoId} sessaoAtual={sessaoAtual} sessoes={sessoes} aoTerminar={() => setAberto(false)} />
      </Modal>
    </>
  );
}

function Formulario({ inscricaoId, sessaoAtual, sessoes, aoTerminar }: { inscricaoId: string; sessaoAtual: string; sessoes: SessaoOpcao[]; aoTerminar: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [estado, acao, salvando] = useActionState<Resultado, FormData>(trocarHorarioAction.bind(null, inscricaoId, sessaoAtual), {});
  useEffect(() => {
    if (estado.ok) {
      toast.sucesso("Horário trocado. A pessoa recebe a confirmação no WhatsApp.");
      aoTerminar();
      router.refresh();
    }
  }, [estado, toast, aoTerminar, router]);
  if (sessoes.length === 0) return <p className="text-sm text-texto-3">Nenhum outro horário agendado nos próximos dias. Crie uma sessão em Sessões.</p>;
  return (
    <form action={acao} className="grid gap-3">
      <CampoSelecao rotulo="Novo horário" name="sessao" required defaultValue="">
        <option value="" disabled>Escolha o dia e a hora</option>
        {sessoes.map((s) => {
          const lotada = s.inscritos >= s.vagas;
          return <option key={s.id} value={s.id} disabled={lotada}>{s.texto} · {lotada ? "lotada" : `${s.vagas - s.inscritos} vaga${s.vagas - s.inscritos === 1 ? "" : "s"}`}</option>;
        })}
      </CampoSelecao>
      {estado.erro && <p className="text-sm text-erro">{estado.erro}</p>}
      <Botao type="submit" carregando={salvando}>Trocar horário</Botao>
    </form>
  );
}
