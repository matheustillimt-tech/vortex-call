"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, UserCheck } from "lucide-react";
import { Modal } from "../_componentes/modal";
import { useToast } from "../_componentes/toast";
import { Botao, BotaoIcone, CampoSelecao, CampoTexto } from "../_componentes/ui";
import { editarPessoa, mudarAtivo } from "./actions";
import { BotaoPermissoes } from "./permissoes";

export type Pessoa = { id: string; nome: string; email: string; papel: "admin" | "membro"; ativo: boolean; whatsapp: string | null; permissoes?: unknown };

/**
 * Lápis (editar) e lixeira da tabela de Usuários. O Vórtex Call não apaga acesso (o histórico aponta
 * pra pessoa), então a lixeira **desativa**; quem está desativado ganha o botão de reativar. Editar muda a categoria
 * e o WhatsApp (avisos do vendedor); nome e e-mail ficam como estão. Na própria linha só dá pra mudar o WhatsApp.
 */
export function AcoesPessoa({ pessoa, souEu }: { pessoa: Pessoa; souEu: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editando, setEditando] = useState(false);
  const [papel, setPapel] = useState(pessoa.papel);
  const [whatsapp, setWhatsapp] = useState(pessoa.whatsapp ?? "");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (papel === pessoa.papel && whatsapp.trim() === (pessoa.whatsapp ?? "")) {
      setEditando(false);
      return;
    }
    setSalvando(true);
    try {
      const r = await editarPessoa(pessoa.id, { papel, whatsapp });
      if (r.erro) {
        toast.erro(r.erro);
        return;
      }
      setEditando(false);
      toast.sucesso("Usuário atualizado.");
      router.refresh();
    } catch {
      toast.erro("Não deu para salvar a alteração.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo() {
    if (
      pessoa.ativo &&
      !(await toast.confirmar({
        titulo: "Você está prestes a desativar um usuário!",
        descricao: `${pessoa.nome} perde o acesso ao painel até ser reativado. O histórico dele continua.`,
        confirmar: "Desativar",
        perigo: true,
      }))
    )
      return;
    try {
      await mudarAtivo(pessoa.id, !pessoa.ativo);
      toast.sucesso(pessoa.ativo ? "Usuário desativado." : "Usuário reativado.");
      router.refresh();
    } catch {
      toast.erro("Não deu para salvar a alteração.");
    }
  }

  return (
    <div className="flex items-center justify-end">
      {souEu && <span className="pr-1 text-xs text-texto-4">Você</span>}
      <BotaoPermissoes pessoa={pessoa} />
      <BotaoIcone
        rotulo="Editar"
        icone={Pencil}
        formato="tabela"
        cor="marca"
        onClick={() => {
          setPapel(pessoa.papel);
          setWhatsapp(pessoa.whatsapp ?? "");
          setEditando(true);
        }}
      />
      {!souEu &&
        (pessoa.ativo ? (
          <BotaoIcone rotulo="Desativar" icone={Trash2} formato="tabela" cor="perigo" onClick={() => void alternarAtivo()} />
        ) : (
          <BotaoIcone rotulo="Reativar" icone={UserCheck} formato="tabela" cor="marca" onClick={() => void alternarAtivo()} />
        ))}

      <Modal
        aberto={editando}
        aoFechar={() => setEditando(false)}
        travado={salvando}
        titulo="Editar usuário"
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setEditando(false)} disabled={salvando}>
              Cancelar
            </Botao>
            <Botao onClick={() => void salvar()} carregando={salvando}>
              Salvar
            </Botao>
          </>
        }
      >
        <div className="space-y-4 text-left">
          <CampoTexto rotulo="Nome do usuário" value={pessoa.nome} disabled readOnly />
          <CampoTexto rotulo="E-mail" value={pessoa.email} disabled readOnly dica="Nome e e-mail não mudam por aqui." />
          <CampoSelecao
            rotulo="Categoria"
            value={papel}
            disabled={souEu}
            dica={souEu ? "Você não muda a própria categoria." : undefined}
            onChange={(e) => setPapel(e.target.value as Pessoa["papel"])}
          >
            <option value="membro">Membro</option>
            <option value="admin">Administrador</option>
          </CampoSelecao>
          <CampoTexto
            rotulo="WhatsApp (opcional)"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="(11) 9XXXX-XXXX"
            dica="Pros avisos do vendedor: novo agendamento, call em 10 minutos e o resumo do dia."
          />
        </div>
      </Modal>
    </div>
  );
}
