"use client";
// Botão vermelho de excluir (agenda, sessão, reunião, gravação): abre o modal com as contagens de
// `contar_dependencias`, exige digitar EXCLUIR e só então chama a server action (que confere admin e o texto de
// novo — nunca confia só no cliente).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./toast";
import { Botao, CampoTexto, estiloBotao } from "./ui";
import { Modal } from "./modal";

export type TipoExclusao = "agenda" | "sessao" | "reuniao" | "gravacao";
export type Contagens = { sessoes: number; inscritos: number; gravacoes: number; avisos: number; vendas: number };

const PALAVRA = "EXCLUIR";

function plural(n: number, singular: string, pluralForma: string): string {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

/** Frases "12 inscritos, 1 gravação, 30 avisos e 2 vendas ligadas (as vendas ficam, sem o vínculo)", na ordem do
 *  `contar_dependencias`. Pra gravação, o próprio total (`gravacoes`) não entra: é a linha que está sendo apagada,
 *  não uma dependência dela. */
function frasesContagens(tipo: TipoExclusao, c: Contagens): string[] {
  const partes: string[] = [];
  if (tipo === "agenda" && c.sessoes > 0) partes.push(plural(c.sessoes, "sessão", "sessões"));
  if (c.inscritos > 0) partes.push(plural(c.inscritos, "inscrito", "inscritos"));
  if (tipo !== "gravacao" && c.gravacoes > 0) partes.push(plural(c.gravacoes, "gravação", "gravações"));
  if (c.avisos > 0) partes.push(plural(c.avisos, "aviso", "avisos"));
  if (c.vendas > 0) partes.push(`${plural(c.vendas, "venda ligada", "vendas ligadas")} (as vendas ficam, sem o vínculo)`);
  return partes;
}

function juntarPtBr(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

export function BotaoExcluir({ tipo, id, nome, contagens, acao, depois, tamanho = "pequeno" }: {
  tipo: TipoExclusao;
  id: string;
  /** Nome mostrado no título do modal ("Excluir {nome}?"). */
  nome: string;
  contagens: Contagens;
  /** Server action: confere admin e o texto digitado de novo antes de apagar. */
  acao: (id: string, confirmacao: string) => Promise<void>;
  /** Página pra onde ir depois de excluir (ex.: a lista, quando o botão está na página do próprio item). Sem ela, só
   *  atualiza a página atual. */
  depois?: string;
  tamanho?: "padrao" | "pequeno";
}) {
  const toast = useToast();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");
  const [excluindo, setExcluindo] = useState(false);

  function fechar() {
    if (excluindo) return;
    setAberto(false);
    setConfirmacao("");
  }

  async function excluir() {
    setExcluindo(true);
    try {
      await acao(id, confirmacao);
      toast.sucesso("Excluído.");
      setAberto(false);
      setConfirmacao("");
      if (depois) router.push(depois);
      else router.refresh();
    } catch (e) {
      toast.erro("Não deu para excluir.", e instanceof Error ? e.message : undefined);
    } finally {
      setExcluindo(false);
    }
  }

  const partes = frasesContagens(tipo, contagens);

  return (
    <>
      <Botao type="button" variante="perigo" tamanho={tamanho} onClick={() => setAberto(true)}>
        Excluir
      </Botao>
      <Modal
        aberto={aberto}
        aoFechar={fechar}
        travado={excluindo}
        titulo={`Excluir ${nome}?`}
        descricao={
          <>
            {partes.length > 0 ? `Isso leva junto ${juntarPtBr(partes)}. ` : ""}
            Isso não pode ser desfeito.
          </>
        }
        rodape={
          <>
            <button type="button" className={estiloBotao("secundario")} onClick={fechar} disabled={excluindo}>
              Cancelar
            </button>
            <Botao variante="perigo" carregando={excluindo} disabled={confirmacao !== PALAVRA} onClick={() => void excluir()}>
              Excluir
            </Botao>
          </>
        }
      >
        <CampoTexto
          rotulo={`Digite ${PALAVRA} para confirmar`}
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          autoComplete="off"
          autoFocus
        />
      </Modal>
    </>
  );
}
