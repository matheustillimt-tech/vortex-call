"use client";
import Link from "next/link";
import { useState } from "react";
import { useActionState } from "react";
import { EVENTOS, ROTULO_EVENTO, type NomeEvento } from "@/src/lib/regras/eventos-nomes";
import { useToast } from "../_componentes/toast";
import { Botao, Cartao, CampoAreaTexto, CampoSelecao, CampoTexto } from "../_componentes/ui";
import { enviarTeste, salvarAgenda, type Resultado } from "./actions";
import type { DadosAgenda } from "@/src/lib/regras/agenda-form";

function BotaoTeste({ agendaId, evento }: { agendaId: string; evento: NomeEvento }) {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  async function clicar() {
    setEnviando(true);
    try {
      const r = await enviarTeste(agendaId, evento);
      if (r.ok) toast.sucesso(`Teste enviado (HTTP ${r.status})`);
      else toast.erro(r.status ? `Falhou (HTTP ${r.status})` : "Não respondeu");
    } catch {
      toast.erro("Não deu para enviar o teste.");
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Botao type="button" variante="secundario" tamanho="pequeno" carregando={enviando} onClick={() => void clicar()}>
      Enviar teste
    </Botao>
  );
}

export function FormularioAgenda({ id, inicial, crmUrls, disparoUrl, pessoas = [] }: {
  id: string | null;
  inicial: DadosAgenda;
  crmUrls?: Record<string, string> | null;
  disparoUrl?: string | null;
  /** Pessoas ativas da equipe (opções do responsável). */
  pessoas?: { id: string; nome: string }[];
}) {
  // Responsável desativado continua aparecendo como opção até alguém trocar (pra não sumir calado ao salvar).
  const semNaLista = inicial.responsavel_id && !pessoas.some((p) => p.id === inicial.responsavel_id);
  const [estado, acao, salvando] = useActionState<Resultado, FormData>(salvarAgenda.bind(null, id), {});
  return (
    <form action={acao} className="grid max-w-3xl gap-4">
      <Cartao titulo="Agenda">
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto rotulo="Nome (só no painel)" name="nome" defaultValue={inicial.nome} required />
          <CampoTexto rotulo="Endereço" name="slug" defaultValue={inicial.slug} dica="call.exemplo.com.br/agendar/…" />
          <CampoTexto rotulo="Título que o lead vê" name="titulo_publico" defaultValue={inicial.titulo_publico} classeCampo="sm:col-span-2" />
          <CampoAreaTexto rotulo="Descrição (opcional)" name="descricao" defaultValue={inicial.descricao} classeCampo="sm:col-span-2" />
          <CampoTexto rotulo="Duração (min)" name="duracao_min" type="number" min={15} max={480} defaultValue={inicial.duracao_min} />
          <CampoTexto rotulo="Vagas por sessão" name="vagas_padrao" type="number" min={1} max={500} defaultValue={inicial.vagas_padrao} />
          <CampoTexto rotulo="Sala abre quantos minutos antes" name="abre_antes_min" type="number" min={0} max={60} defaultValue={inicial.abre_antes_min} />
          <CampoTexto
            rotulo="Mostrar os próximos ___ dias com horário (vazio = todos)"
            name="janela_dias"
            type="number"
            min={1}
            max={60}
            defaultValue={inicial.janela_dias ?? ""}
            placeholder="Todos"
            dica="Conta só dias que ainda têm horário com vaga, a partir de hoje. Com 2: sexta à tarde mostra o resto de sexta e segunda; no sábado, segunda e terça."
          />
          <CampoSelecao
            rotulo="Responsável (vendedor)"
            name="responsavel_id"
            defaultValue={inicial.responsavel_id ?? ""}
            info="Vê só os dados desta agenda (e das outras dele), entra nas salas como anfitrião e recebe os avisos no WhatsApp."
          >
            <option value="">Sem responsável</option>
            {semNaLista && <option value={inicial.responsavel_id!}>Pessoa desativada</option>}
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </CampoSelecao>
        </div>
        <div className="mt-4 flex flex-wrap gap-6">
          <label className="flex items-center gap-2"><input type="checkbox" name="grava_sozinha" defaultChecked={inicial.grava_sozinha} /> Gravar sozinha</label>
          <label className="flex items-center gap-2" title="Transcreve a call em português e avisa na sala que ela é transcrita. Vale pras salas abertas depois de ligar.">
            <input type="checkbox" name="transcrever" defaultChecked={inicial.transcrever} /> Transcrever e resumir a call
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" name="ativa" defaultChecked={inicial.ativa} /> Agenda ativa</label>
        </div>
      </Cartao>
      <Cartao titulo="Roteiro da call" ajuda="Aparece na coluna do anfitrião durante a call.">
        <CampoAreaTexto rotulo="Roteiro" name="roteiro" defaultValue={inicial.roteiro} className="min-h-48" />
      </Cartao>
      <Cartao titulo="Avisos pro CRM (webhooks)" ajuda="Avisa o seu CRM quando um evento acontece (agendou, lembrete, começou, compareceu, faltou), pra ele disparar a mensagem no WhatsApp.">
        <div className="grid gap-4">
          {EVENTOS.map((evento) => (
            <div key={evento} className="flex flex-wrap items-end gap-2">
              <CampoTexto
                rotulo={ROTULO_EVENTO[evento]}
                name={`crm_url_${evento}`}
                defaultValue={crmUrls?.[evento] ?? ""}
                placeholder="https://…"
                classeCampo="min-w-64 flex-1"
              />
              {id && crmUrls?.[evento] && <BotaoTeste agendaId={id} evento={evento} />}
            </div>
          ))}
        </div>
        <div className="mt-4">
          <CampoTexto
            rotulo="Disparo pela API oficial (opcional)"
            name="disparo_url"
            defaultValue={disparoUrl ?? ""}
            placeholder="https://…"
            dica="Webhook de uma ferramenta de disparo pela API oficial do WhatsApp: recebe agendou, lembretes, começou e faltou pra mandar a mensagem pelo número oficial. O CRM continua recebendo pelas URLs acima."
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <CampoTexto rotulo="Segredo (opcional)" name="crm_segredo" type="password" dica={id ? "Deixe vazio para manter o atual." : "Vai no cabeçalho X-Webhook-Secret."} />
          {id && (
            <label className="flex items-center gap-2 pb-[7px] text-sm text-texto-2">
              <input type="checkbox" name="crm_remover_segredo" /> Remover segredo
            </label>
          )}
        </div>
        <p className="mt-4 text-sm">
          <a className="text-marca underline" href="https://github.com/matheustillimt-tech/vortex-call/blob/main/docs/avisos-crm.md" target="_blank" rel="noreferrer">
            Como configurar
          </a>
          {id && (
            <>
              {" · "}
              <Link className="text-marca underline" href={`/agendas/${id}/avisos`}>
                Ver avisos enviados
              </Link>
            </>
          )}
        </p>
      </Cartao>
      {estado.erro && <p className="text-sm text-erro">{estado.erro}</p>}
      {estado.ok && <p className="text-sm text-ok">Salvo.</p>}
      <div><Botao type="submit" carregando={salvando}>Salvar</Botao></div>
    </form>
  );
}
