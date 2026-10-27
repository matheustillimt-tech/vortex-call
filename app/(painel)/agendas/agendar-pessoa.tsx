"use client";
import { CalendarPlus } from "lucide-react";
import { useActionState, useState } from "react";
import { BotaoCopiar } from "../_componentes/copiar";
import { Modal } from "../_componentes/modal";
import { Botao, CampoSelecao, CampoTexto, estiloBotaoIcone } from "../_componentes/ui";
import { agendarPessoa, type ResultadoAgendar } from "./actions";

export type SessaoOpcao = { id: string; texto: string; vagas: number; inscritos: number };

const AVISO: Record<NonNullable<ResultadoAgendar["resultado"]>, string> = {
  nova: "Agendado! A pessoa recebe a confirmação no WhatsApp.",
  reagendada: "Essa pessoa já tinha outro horário nesta agenda: foi movida pra esta sessão e recebe a confirmação no WhatsApp.",
  mesma: "Essa pessoa já estava nesta sessão. Nada mudou.",
};

/** Botão da linha da agenda: abre o cadastro manual (nome, telefone, e-mail e sessão). Sessões lotadas aparecem
 *  desabilitadas. Depois de agendar, mostra o link pessoal da sala pra copiar. */
export function AgendarPessoa({ agendaId, agendaNome, sessoes }: { agendaId: string; agendaNome: string; sessoes: SessaoOpcao[] }) {
  const [aberto, setAberto] = useState(false);
  const [chave, setChave] = useState(0);
  return (
    <>
      <button type="button" aria-label="Agendar pessoa" title="Agendar pessoa" onClick={() => { setChave((c) => c + 1); setAberto(true); }} className={estiloBotaoIcone("tabela", "marca")}>
        <CalendarPlus size={20} aria-hidden />
      </button>
      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo="Agendar pessoa" descricao={agendaNome}>
        <Formulario key={chave} agendaId={agendaId} sessoes={sessoes} />
      </Modal>
    </>
  );
}

function Formulario({ agendaId, sessoes }: { agendaId: string; sessoes: SessaoOpcao[] }) {
  const [estado, acao, salvando] = useActionState<ResultadoAgendar, FormData>(agendarPessoa.bind(null, agendaId), {});
  if (estado.ok && estado.link) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-ok">{AVISO[estado.resultado ?? "nova"]}</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded border border-borda px-2 py-2 text-sm">{estado.link}</code>
          <BotaoCopiar texto={estado.link} formato="botao" />
        </div>
      </div>
    );
  }
  if (sessoes.length === 0) return <p className="text-sm text-texto-3">Nenhuma sessão agendada nos próximos dias. Crie uma em Sessões.</p>;
  return (
    <form action={acao} className="grid gap-3">
      <CampoTexto rotulo="Nome" name="nome" required maxLength={120} autoComplete="off" />
      <CampoTexto rotulo="Telefone (WhatsApp com DDD)" name="whatsapp" type="tel" required placeholder="(11) 9XXXX-XXXX" autoComplete="off" />
      <CampoTexto rotulo="E-mail" name="email" type="email" maxLength={200} autoComplete="off" />
      <CampoSelecao rotulo="Sessão" name="sessao" required defaultValue={sessoes.find((s) => s.inscritos < s.vagas)?.id ?? ""}>
        <option value="" disabled>Escolha o dia e a hora</option>
        {sessoes.map((s) => {
          const lotada = s.inscritos >= s.vagas;
          return <option key={s.id} value={s.id} disabled={lotada}>{s.texto} · {lotada ? "lotada" : `${s.vagas - s.inscritos} vaga${s.vagas - s.inscritos === 1 ? "" : "s"}`}</option>;
        })}
      </CampoSelecao>
      {estado.erro && <p className="text-sm text-erro">{estado.erro}</p>}
      <Botao type="submit" carregando={salvando}>Agendar</Botao>
    </form>
  );
}
