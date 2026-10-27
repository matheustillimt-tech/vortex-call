"use client";
import { useActionState, useState } from "react";
import { Modal } from "../_componentes/modal";
import { Botao, CampoSelecao, CampoTexto, Segmentos } from "../_componentes/ui";
import { criarRepeticao, criarSessao, type Resultado } from "./actions";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Admin vê todas as agendas ativas; o responsável (membro), só as dele (RLS). `tipoInicial` = aba que abre primeiro
 *  (na tela Horários, "Toda semana"). */
export function NovaSessao({ agendas, tipoInicial = "avulsa", rotulo = "Nova sessão" }: {
  agendas: { id: string; nome: string; vagas_padrao: number }[];
  tipoInicial?: "avulsa" | "semanal";
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<"avulsa" | "semanal">(tipoInicial);
  const [estadoA, acaoA, salvandoA] = useActionState<Resultado, FormData>(criarSessao, {});
  const [estadoS, acaoS, salvandoS] = useActionState<Resultado, FormData>(criarRepeticao, {});
  const estado = tipo === "avulsa" ? estadoA : estadoS;
  const campoAgenda = (
    <CampoSelecao rotulo="Agenda" name="agenda_id" required>
      {agendas.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
    </CampoSelecao>
  );
  return (
    <>
      <Botao onClick={() => setAberto(true)}>{rotulo}</Botao>
      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo={rotulo}>
        <Segmentos opcoes={[{ valor: "avulsa", rotulo: "Uma vez" }, { valor: "semanal", rotulo: "Toda semana" }]} valor={tipo} aoMudar={setTipo} />
        {tipo === "avulsa" ? (
          <form action={acaoA} className="mt-4 grid gap-3">
            {campoAgenda}
            <CampoTexto rotulo="Dia e hora (Brasília)" name="inicio" type="datetime-local" required />
            <CampoTexto rotulo="Vagas" name="vagas" type="number" min={1} max={500} defaultValue={agendas[0]?.vagas_padrao ?? 30} />
            <CampoTexto rotulo="Título (opcional)" name="titulo" />
            <Botao type="submit" carregando={salvandoA}>Criar</Botao>
          </form>
        ) : (
          <form action={acaoS} className="mt-4 grid gap-3">
            {campoAgenda}
            <div className="flex flex-wrap gap-3">
              {DIAS.map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" name="dias" value={i} /> {d}</label>)}
            </div>
            <CampoTexto rotulo="Hora (Brasília)" name="hora" type="time" required />
            <CampoTexto rotulo="Vagas" name="vagas" type="number" min={1} max={500} defaultValue={agendas[0]?.vagas_padrao ?? 30} />
            <CampoTexto rotulo="Até (opcional)" name="ate" type="date" />
            <Botao type="submit" carregando={salvandoS}>Salvar repetição</Botao>
          </form>
        )}
        {estado.erro && <p className="mt-3 text-sm text-erro">{estado.erro}</p>}
        {estado.ok && <p className="mt-3 text-sm text-ok">Pronto.</p>}
      </Modal>
    </>
  );
}
