import { notFound } from "next/navigation";
import { contarDependencias } from "@/src/lib/api/excluir";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { siteUrl } from "@/src/lib/env";
import { BotaoCopiar } from "../../_componentes/copiar";
import { BotaoExcluir } from "../../_componentes/excluir";
import { Pagina } from "../../_componentes/ui";
import { excluirAgendaAction } from "../actions";
import { FormularioAgenda } from "../formulario";
import type { DadosAgenda } from "@/src/lib/regras/agenda-form";

export const dynamic = "force-dynamic";

const NOVA: DadosAgenda = {
  nome: "", slug: "", titulo_publico: "Escolha o melhor horário pra sua call", descricao: "", duracao_min: 60,
  vagas_padrao: 30, abre_antes_min: 5, roteiro: "", grava_sozinha: true, transcrever: false, ativa: true, responsavel_id: null, janela_dias: null,
};

export default async function Agenda({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();
  // Quem pode ser o responsável (vendedor): pessoas ativas da equipe.
  const { data: equipe } = await db.from("usuarios").select("id, nome").eq("ativo", true).order("nome");
  const pessoas = (equipe ?? []) as { id: string; nome: string }[];
  if (id === "nova") return <Pagina titulo="Nova agenda" trilha={[{ rotulo: "Agendas", href: "/agendas" }, { rotulo: "Nova" }]}><FormularioAgenda id={null} inicial={NOVA} pessoas={pessoas} /></Pagina>;
  const { data } = await db.from("agendas").select("nome, slug, titulo_publico, descricao, duracao_min, vagas_padrao, abre_antes_min, roteiro, grava_sozinha, transcrever, ativa, crm_urls, disparo_url, responsavel_id, janela_dias").eq("id", id).maybeSingle();
  if (!data) notFound();
  const site = siteUrl();
  const encaixe = `<script src="${site}/agendar.js" data-agenda="${data.slug}"></script>`;
  const contagens = await contarDependencias(db, "agenda", id);
  return (
    <Pagina
      titulo={data.nome}
      trilha={[{ rotulo: "Agendas", href: "/agendas" }, { rotulo: data.nome }]}
      acoes={
        <div className="flex gap-2">
          <BotaoCopiar texto={`${site}/agendar/${data.slug}`} rotulo="Copiar link" formato="botao" />
          <BotaoCopiar texto={encaixe} rotulo="Copiar código de encaixe" formato="botao" />
          <BotaoExcluir tipo="agenda" id={id} nome={data.nome} contagens={contagens} acao={excluirAgendaAction} depois="/agendas" />
        </div>
      }
    >
      <FormularioAgenda id={id} inicial={data as DadosAgenda} crmUrls={data.crm_urls as Record<string, string> | null} disparoUrl={(data.disparo_url as string | null) ?? null} pessoas={pessoas} />
    </Pagina>
  );
}
