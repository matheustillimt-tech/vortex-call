"use client";
// Botão "Permissões" da linha do membro em Equipe: modal com uma chave liga/desliga por permissão (texto curto embaixo
// de cada uma). Admin tem tudo sempre: pra ele o botão fica desligado, com o aviso. Quem decide de verdade é a server
// action `salvarPermissoes` (só admin, ignora chave desconhecida, não mexe em admin) e o banco (`tem_permissao`).
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { ADMIN_TEM_TUDO, lerPermissoes, PERMISSOES, type ChavePermissao, type Permissoes } from "@/src/lib/regras/permissoes";
import { Modal } from "../_componentes/modal";
import { useToast } from "../_componentes/toast";
import { Botao, BotaoIcone } from "../_componentes/ui";
import { salvarPermissoes } from "./actions";

/** Chave liga/desliga (switch acessível): botão com `role="switch"` e `aria-checked`. */
function Interruptor({ ligado, aoMudar, rotulo, descricao, desativado }: {
  ligado: boolean;
  aoMudar: (v: boolean) => void;
  rotulo: string;
  descricao: string;
  desativado?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-texto">{rotulo}</label>
        <p id={`${id}-d`} className="text-xs text-texto-3">{descricao}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-describedby={`${id}-d`}
        disabled={desativado}
        onClick={() => aoMudar(!ligado)}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40 disabled:opacity-50 ${ligado ? "bg-marca" : "bg-apagado"}`}
      >
        <span aria-hidden className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${ligado ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

export function BotaoPermissoes({ pessoa }: { pessoa: { id: string; nome: string; papel: "admin" | "membro"; permissoes?: unknown } }) {
  const router = useRouter();
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [valores, setValores] = useState<Permissoes>(() => lerPermissoes(pessoa.permissoes));
  const [salvando, setSalvando] = useState(false);

  if (pessoa.papel === "admin") {
    // Botão desligado não mostra o title (sem ponteiro): o aviso fica no span em volta.
    return (
      <span title={ADMIN_TEM_TUDO} className="inline-flex">
        <BotaoIcone rotulo={ADMIN_TEM_TUDO} icone={KeyRound} formato="tabela" cor="neutro" disabled />
      </span>
    );
  }

  function abrir() {
    setValores(lerPermissoes(pessoa.permissoes));
    setAberto(true);
  }

  async function salvar() {
    setSalvando(true);
    try {
      const r = await salvarPermissoes(pessoa.id, valores);
      if (r.erro) {
        toast.erro(r.erro);
        return;
      }
      setAberto(false);
      toast.sucesso("Permissões salvas.", `Valem já pra ${pessoa.nome}.`);
      router.refresh();
    } catch {
      toast.erro("Não deu para salvar as permissões.");
    } finally {
      setSalvando(false);
    }
  }

  const mudar = (chave: ChavePermissao) => (v: boolean) => setValores((atual) => ({ ...atual, [chave]: v }));

  return (
    <>
      <BotaoIcone rotulo="Permissões" title="Permissões" icone={KeyRound} formato="tabela" cor="marca" onClick={abrir} />
      <Modal
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        travado={salvando}
        titulo={`Permissões de ${pessoa.nome}`}
        descricao="O que este membro pode fazer. Vale nas agendas em que ele é o responsável (a não ser “Ver todas as agendas”)."
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setAberto(false)} disabled={salvando}>
              Cancelar
            </Botao>
            <Botao onClick={() => void salvar()} carregando={salvando}>
              Salvar
            </Botao>
          </>
        }
      >
        <div className="divide-y divide-linha text-left">
          {PERMISSOES.map((p) => (
            <Interruptor key={p.chave} rotulo={p.rotulo} descricao={p.descricao} ligado={valores[p.chave]} aoMudar={mudar(p.chave)} desativado={salvando} />
          ))}
        </div>
      </Modal>
    </>
  );
}
