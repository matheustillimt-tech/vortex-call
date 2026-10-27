"use client";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { BotaoCopiar } from "../_componentes/copiar";
import { Modal } from "../_componentes/modal";
import { useToast } from "../_componentes/toast";
import { Botao, CampoSelecao, CampoTexto } from "../_componentes/ui";
import { criarChaveIntegracao, revogarChaveIntegracao, type Resultado } from "./actions";

/** `claude mcp add` pronto pra colar, com a chave de verdade (ou `SUA_CHAVE` antes de criar uma). */
function comandoMcp(urlMcp: string, chave: string) {
  return `claude mcp add --transport http vortex-call ${urlMcp} --header "Authorization: Bearer ${chave}"`;
}

function FormularioNova({ urlMcp, aoFechar }: { urlMcp: string; aoFechar: () => void }) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(criarChaveIntegracao, {});

  if (estado.chave) {
    return (
      <div className="space-y-4">
        <div className="space-y-2 rounded-md border border-marca-funil bg-marca-linha p-4">
          <p className="text-sm font-medium text-texto">Copie agora: ela não aparece de novo.</p>
          <code className="block break-all rounded-md bg-superficie px-3 py-2 text-xs">{estado.chave}</code>
          <BotaoCopiar texto={estado.chave} formato="botao" aviso="Chave copiada." />
        </div>
        <div className="space-y-2">
          <p className="text-sm text-texto-2">Comando pra conectar o Claude:</p>
          <pre className="max-h-40 overflow-auto rounded-md bg-suave p-3 text-xs break-all whitespace-pre-wrap">{comandoMcp(urlMcp, estado.chave)}</pre>
          <BotaoCopiar texto={comandoMcp(urlMcp, estado.chave)} formato="botao" aviso="Comando copiado." />
        </div>
        <div className="flex justify-end">
          <Botao type="button" onClick={aoFechar}>
            Pronto
          </Botao>
        </div>
      </div>
    );
  }

  return (
    <form action={enviar} className="space-y-4">
      <CampoTexto rotulo="Nome da chave" name="nome" required maxLength={60} autoFocus placeholder="Claude da Ana" />
      <CampoSelecao rotulo="Permissão" name="permissao" defaultValue="escrita" info="Leitura só consulta (agendas, sessões, gravações). Escrita também cria sessões e reuniões.">
        <option value="escrita">Leitura e escrita</option>
        <option value="leitura">Só leitura</option>
      </CampoSelecao>
      {estado.erro && <p role="alert" className="text-sm text-erro">{estado.erro}</p>}
      <div className="flex flex-col-reverse gap-2 pn-sm:flex-row pn-sm:justify-end">
        <Botao type="button" variante="secundario" onClick={aoFechar} disabled={enviando}>
          Cancelar
        </Botao>
        <Botao carregando={enviando}>Criar chave</Botao>
      </div>
    </form>
  );
}

export function CriarChave({ urlMcp }: { urlMcp: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [rodada, setRodada] = useState(0);
  const fechar = () => {
    setAberto(false);
    router.refresh();
  };
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
        Criar chave
      </Botao>
      <Modal aberto={aberto} aoFechar={fechar} titulo="Nova chave de acesso">
        <FormularioNova key={rodada} urlMcp={urlMcp} aoFechar={fechar} />
      </Modal>
    </>
  );
}

export function RevogarChave({ id, nome }: { id: string; nome: string }) {
  const router = useRouter();
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  return (
    <>
      <Botao type="button" tamanho="pequeno" variante="perigo" onClick={() => setAberto(true)}>
        Revogar
      </Botao>
      <Modal
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        travado={pendente}
        titulo="Revogar chave?"
        descricao={`"${nome}" para de funcionar na hora. Quem usa essa chave (API ou Claude) perde o acesso.`}
        rodape={
          <>
            <Botao type="button" variante="secundario" onClick={() => setAberto(false)} disabled={pendente}>
              Cancelar
            </Botao>
            <Botao
              type="button"
              variante="perigo"
              carregando={pendente}
              onClick={() =>
                iniciar(async () => {
                  const r = await revogarChaveIntegracao(id);
                  if (r.erro) toast.erro(r.erro);
                  else toast.sucesso("Chave revogada.");
                  setAberto(false);
                  router.refresh();
                })
              }
            >
              Revogar
            </Botao>
          </>
        }
      />
    </>
  );
}
