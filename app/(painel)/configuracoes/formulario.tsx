"use client";
import { useActionState, useState } from "react";
import { useToast } from "../_componentes/toast";
import { Botao, Cartao, CampoTexto } from "../_componentes/ui";
import { enviarTesteEquipe, salvarConfiguracao, type Resultado } from "./actions";

type Inicial = {
  nome: string;
  logo_url: string | null;
  cor_marca: string;
  whatsapp_suporte: string | null;
  crm_url_equipe: string | null;
  temSegredoEquipe: boolean;
};

function BotaoTesteEquipe() {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  async function clicar() {
    setEnviando(true);
    try {
      const r = await enviarTesteEquipe();
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

export function FormularioConfiguracao({ inicial }: { inicial: Inicial }) {
  const [estado, acao, salvando] = useActionState<Resultado, FormData>(salvarConfiguracao, {});
  return (
    <form action={acao} className="grid max-w-xl gap-4">
      <Cartao titulo="Marca na sala e no agendamento">
        <div className="grid gap-4">
          <CampoTexto rotulo="Nome" name="nome" defaultValue={inicial.nome} required />
          <CampoTexto rotulo="Link do logo (https)" name="logo_url" defaultValue={inicial.logo_url ?? ""} />
          <CampoTexto rotulo="Cor" name="cor_marca" type="color" defaultValue={inicial.cor_marca} />
          <CampoTexto rotulo="WhatsApp de suporte" name="whatsapp_suporte" defaultValue={inicial.whatsapp_suporte ?? ""} />
        </div>
      </Cartao>
      <Cartao
        titulo="Avisos pra equipe (webhook)"
        ajuda="Avisa no WhatsApp o vendedor responsável pela agenda: novo agendamento, call em 10 minutos e o resumo das calls do dia às 08:00. Uma URL só pra equipe toda; o WhatsApp de cada vendedor fica em Equipe."
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <CampoTexto rotulo="URL do webhook" name="crm_url_equipe" defaultValue={inicial.crm_url_equipe ?? ""} placeholder="https://…" classeCampo="min-w-64 flex-1" />
            {inicial.crm_url_equipe && <BotaoTesteEquipe />}
          </div>
          <CampoTexto
            rotulo="Segredo (opcional)"
            name="crm_segredo_equipe"
            type="password"
            dica={inicial.temSegredoEquipe ? "Já tem um segredo salvo. Deixe vazio para manter." : "Vai no cabeçalho X-Webhook-Secret."}
          />
          {inicial.temSegredoEquipe && (
            <label className="flex items-center gap-2 text-sm text-texto-2">
              <input type="checkbox" name="crm_remover_segredo_equipe" /> Remover segredo
            </label>
          )}
          <p className="text-sm">
            <a className="text-marca underline" href="https://github.com/matheustillimt-tech/vortex-call/blob/main/docs/avisos-crm.md#avisos-pra-equipe" target="_blank" rel="noreferrer">
              Como configurar
            </a>
          </p>
        </div>
      </Cartao>
      {estado.erro && <p role="alert" className="text-sm text-erro">{estado.erro}</p>}
      {estado.ok && <p className="text-sm text-ok">Salvo.</p>}
      <div>
        <Botao type="submit" carregando={salvando}>Salvar</Botao>
      </div>
    </form>
  );
}
