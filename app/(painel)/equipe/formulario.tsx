"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal } from "../_componentes/modal";
import { useToast } from "../_componentes/toast";
import { Botao, CampoSelecao, CampoTexto } from "../_componentes/ui";
import { criarPessoa, type Resultado } from "./actions";

/** Formulário do modal "Criar novo usuário". A senha inicial é definida aqui e passada à pessoa por fora (não há
 *  e-mail de convite no Vórtex Call). */
function FormularioNovo({ aoCriar, aoCancelar }: { aoCriar: () => void; aoCancelar: () => void }) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(criarPessoa, {});
  useEffect(() => {
    if (estado.ok) aoCriar();
    // Só reage a um novo resultado da action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={enviar} className="space-y-4">
      <CampoTexto rotulo="Nome do usuário" name="nome" required autoFocus />
      <CampoTexto rotulo="E-mail" name="email" type="email" required />
      <CampoTexto rotulo="Senha inicial" name="senha" type="text" required minLength={8} dica="Mínimo de 8 caracteres. Passe a senha à pessoa por um canal seguro." />
      <CampoTexto rotulo="WhatsApp (opcional)" name="whatsapp" type="tel" placeholder="(11) 9XXXX-XXXX" dica="Pros avisos de vendedor (agendamentos, call em 10 minutos, resumo do dia)." />
      <CampoSelecao rotulo="Categoria" name="papel" defaultValue="membro" info="Administradores mexem em tudo. Membros veem só as agendas em que são o responsável (vendedor).">
        <option value="membro">Membro</option>
        <option value="admin">Administrador</option>
      </CampoSelecao>
      {estado.erro && <p role="alert" className="text-sm text-erro">{estado.erro}</p>}
      <div className="flex flex-col-reverse gap-2 pn-sm:flex-row pn-sm:justify-end">
        <Botao type="button" variante="secundario" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Botao>
        <Botao carregando={enviando}>Criar usuário</Botao>
      </div>
    </form>
  );
}

export function CriarUsuario() {
  const router = useRouter();
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [rodada, setRodada] = useState(0);

  return (
    <>
      <Botao
        tamanho="pequeno"
        className="h-9"
        icone={<Plus aria-hidden />}
        onClick={() => {
          setRodada((r) => r + 1);
          setAberto(true);
        }}
      >
        Criar novo usuário
      </Botao>
      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo="Criar novo usuário">
        <FormularioNovo
          key={rodada}
          aoCancelar={() => setAberto(false)}
          aoCriar={() => {
            setAberto(false);
            toast.sucesso("Usuário criado.", "Passe o e-mail e a senha a ele por um canal seguro.");
            router.refresh();
          }}
        />
      </Modal>
    </>
  );
}
