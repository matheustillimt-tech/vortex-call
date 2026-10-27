import { notFound } from "next/navigation";
import { ChartColumn } from "lucide-react";
import { contarDependencias } from "@/src/lib/api/excluir";
import { formatarSegundos, type AtividadeLead } from "@/src/lib/regras/atividade";
import { rotuloAnfitriao } from "@/src/lib/regras/anfitriao";
import { leadNaSessao } from "@/src/lib/regras/dashboard";
import { formatarDataHora, formatarHora, formatarSessao } from "@/src/lib/regras/fuso";
import { interagiu } from "@/src/lib/regras/interacao";
import { ROTULO_EVENTO_CURTO, type NomeEvento } from "@/src/lib/regras/eventos";
import { exigirAcessoSessao, podeVerSessao } from "@/src/lib/acesso";
import { mascararEmail, mascararWhatsapp } from "@/src/lib/regras/contato";
import { pode } from "@/src/lib/regras/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { BotaoExcluir } from "../../_componentes/excluir";
import { TEM_INSCRITOS } from "@/src/lib/regras/acesso";
import { BotaoLink, Cartao, Pagina, Selo, Tabela, estiloCelula, type CorSelo } from "../../_componentes/ui";
import { BotaoCopiar } from "../../_componentes/copiar";
import { resumoDaSessao, type EstadoResumoCall } from "@/src/lib/api/resumos";
import { listarSessoes } from "@/src/lib/api/sessoes";
import type { SessaoOpcao } from "../../agendas/agendar-pessoa";
import { excluirSessaoAction } from "../actions";
import { BotaoCancelarSessao, EditarVagas } from "../gerir";
import { TrocarHorario } from "../trocar-horario";

export const dynamic = "force-dynamic";
const FUSO = "America/Sao_Paulo";
const STATUS = { agendado: ["destaque", "Agendou"], compareceu: ["ok", "Veio"], faltou: ["erro", "Faltou"], cancelado: ["neutro", "Cancelou"] } as const;

const COR_AVISO: Record<string, CorSelo> = { enviado: "ok", pendente: "aviso", falhou: "erro", sem_destino: "neutro" };
const ROTULO_STATUS_AVISO: Record<string, string> = { enviado: "Enviado", pendente: "Pendente", falhou: "Falhou", sem_destino: "Sem destino" };

export default async function Sessao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eu = await exigirAcessoSessao(id);
  const db = await dbUsuario();
  const { data: s } = await db.from("sessoes").select("id, inicio, vagas, status, titulo, anfitriao_entrou_em, agendas(nome, duracao_min, slug), anfitriao:usuarios!sessoes_anfitriao_id_fkey(nome)").eq("id", id).maybeSingle();
  if (!s) notFound();
  // Inscritos pela service role: o cliente da equipe não lê o WhatsApp/e-mail do lead (migração
  // 20261024120000_permissoes.sql). O acesso à sessão já foi conferido; sem `contato_lead`, mascara aqui, antes de
  // mandar pra tela.
  const verContato = pode(eu, "contato_lead");
  const { data: brutos } = await dbAdmin().from("inscricoes").select("id, nome, whatsapp, email, status, minutos_na_sala, created_at").eq("sessao_id", id).order("created_at");
  const inscritos = ((brutos ?? []) as { id: string; nome: string; whatsapp: string; email: string | null; status: string; minutos_na_sala: number; created_at: string }[]).map((i) =>
    verContato ? i : { ...i, whatsapp: mascararWhatsapp(i.whatsapp), email: mascararEmail(i.email) },
  );
  const { data: avisos } = await db.from("eventos").select("inscricao_id, evento, destino, status, enviado_em, proxima_em, created_at").eq("sessao_id", id);
  const { data: atividades } = await db.from("atividade_lead").select("inscricao_id, mic_s, cam_s, msgs").eq("sessao_id", id);
  // Minutos e nota com a regra do painel e do dashboard (presenças cortadas no início; ver `leadNaSessao`).
  const { data: presencas } = await db.from("presencas").select("inscricao_id, entrou_em, saiu_em").eq("sessao_id", id);
  type Presenca = { inscricao_id: string; entrou_em: string; saiu_em: string | null };
  const presencasPor = new Map<string, Presenca[]>();
  for (const p of (presencas ?? []) as Presenca[]) presencasPor.set(p.inscricao_id, [...(presencasPor.get(p.inscricao_id) ?? []), p]);
  const agora = new Date();
  const anfitriao = rotuloAnfitriao({ nome: (s.anfitriao as unknown as { nome: string } | null)?.nome, status: s.status, inicio: s.inicio, agora });
  const entrouEm = s.anfitriao_entrou_em ? ` (entrou às ${formatarHora(new Date(s.anfitriao_entrou_em), FUSO)})` : "";
  const atividadePorInscricao = new Map<string, AtividadeLead>((atividades ?? []).map((a) => [a.inscricao_id as string, a as AtividadeLead]));
  const avisosPorInscricao = new Map<string, NonNullable<typeof avisos>>();
  for (const a of avisos ?? []) {
    const lista = avisosPorInscricao.get(a.inscricao_id) ?? [];
    lista.push(a);
    avisosPorInscricao.set(a.inscricao_id, lista);
  }
  const agenda = s.agendas as unknown as { nome: string; duracao_min: number; slug: string } | null;
  const nome = s.titulo ?? agenda?.nome ?? "Sessão";
  // Quem chega aqui é admin, o responsável pela agenda ou um membro com `todas_agendas` (só leitura). Mexer (sala,
  // vagas, cancelar) só o gestor (admin ou responsável) e com a permissão de cada coisa; as actions e rotas conferem
  // de novo. Membro só cancela sessão sem inscrito ativo.
  const gestor = await podeVerSessao(eu, id);
  const mexeHorarios = gestor && pode(eu, "horarios");
  const agendada = s.status === "agendada";
  const inscritosAtivos = inscritos.filter((i) => i.status === "agendado").length;
  const bloqueioCancelar = eu.papel !== "admin" && inscritosAtivos > 0 ? TEM_INSCRITOS : undefined;
  const podeExcluir = eu.papel === "admin";
  const salaAberta = s.status === "agendada" || s.status === "ao_vivo";
  const entraAnfitriao = salaAberta && gestor && pode(eu, "anfitriao");
  const entraEspiao = salaAberta && gestor && pode(eu, "espiao");
  // "Trocar horário": as outras sessões agendadas da mesma agenda (próximos 14 dias), pelo servidor (a contagem de
  // inscrições não funciona pelo login da equipe).
  const outrasSessoes: SessaoOpcao[] = mexeHorarios && agenda
    ? (await listarSessoes(dbAdmin(), { agenda: agenda.slug }))
        .filter((o) => o.status === "agendada" && o.id !== s.id)
        .map((o) => ({ id: o.id, texto: o.inicio_texto, vagas: o.vagas, inscritos: o.inscritos }))
    : [];
  const contagens = podeExcluir ? await contarDependencias(db, "sessao", id) : null;
  // Resumo da call (sessão transcrita): pela service role, depois do acesso conferido; precisa da permissão `transcricao`.
  const resumo = pode(eu, "transcricao") ? await resumoDaSessao(dbAdmin(), id).catch(() => null) : null;
  return (
    <Pagina
      titulo={nome}
      subtitulo={
        <>
          {formatarSessao(new Date(s.inicio), FUSO)} · Anfitrião:{" "}
          <span className={anfitriao.aviso ? "font-medium text-aviso" : ""}>{anfitriao.texto}{entrouEm}</span>
        </>
      }
      trilha={[{ rotulo: "Sessões", href: "/sessoes" }, { rotulo: nome }]}
      acoes={
        <>
          {!gestor && <Selo cor="neutro">Só leitura</Selo>}
          {pode(eu, "dashboard") && (
            <BotaoLink href={`/sessoes/${s.id}/painel`} variante="secundario" icone={<ChartColumn />}>
              Painel da sessão
            </BotaoLink>
          )}
          {entraAnfitriao && (
            <BotaoLink href={`/equipe/sala/${s.id}?modo=anfitriao`} variante="secundario" target="_blank" rel="noreferrer">
              Entrar como anfitrião
            </BotaoLink>
          )}
          {entraEspiao && (
            <BotaoLink href={`/equipe/sala/${s.id}?modo=espiao`} variante="secundario" target="_blank" rel="noreferrer">
              Entrar como espião
            </BotaoLink>
          )}
          {agendada && mexeHorarios && <EditarVagas id={s.id} vagas={s.vagas} inscritos={inscritosAtivos} />}
          {agendada && mexeHorarios && <BotaoCancelarSessao id={s.id} inscritos={inscritosAtivos} bloqueio={bloqueioCancelar} />}
          {podeExcluir && contagens && <BotaoExcluir tipo="sessao" id={id} nome={nome} contagens={contagens} acao={excluirSessaoAction} depois="/sessoes" />}
        </>
      }
    >
      <Tabela colunas={["Nome", "WhatsApp", "E-mail", "Situação", "Na sala", "Microfone", "Câmera", "Mensagens", "Interação", "Avisos", ...(mexeHorarios ? [""] : [])]} vazio={inscritos.length ? undefined : "Ninguém inscrito ainda."}>
        {inscritos.map((i) => {
          const [cor, rotulo] = STATUS[i.status as keyof typeof STATUS];
          const atv = atividadePorInscricao.get(i.id);
          const { veio, minutos, nota } = leadNaSessao({
            status: i.status,
            presencas: presencasPor.get(i.id) ?? [],
            inicio: new Date(s.inicio),
            duracaoMin: agenda?.duracao_min ?? 0,
            agora,
            minutosNaSala: i.minutos_na_sala,
            atividade: atv,
          });
          return (
            <tr key={i.id}>
              <td className={estiloCelula}>{i.nome}</td>
              <td className={`${estiloCelula} whitespace-nowrap`}>
                {verContato ? <a className="text-marca" href={`https://wa.me/${i.whatsapp.replace("+", "")}`} target="_blank" rel="noreferrer">{i.whatsapp}</a> : i.whatsapp}
              </td>
              <td className={estiloCelula}>{i.email ?? "—"}</td>
              <td className={estiloCelula}><Selo cor={cor}>{rotulo}</Selo></td>
              <td className={estiloCelula}>{veio && minutos > 0 ? `${minutos} min` : "—"}</td>
              <td className={estiloCelula}>{formatarSegundos(atv?.mic_s ?? 0)}</td>
              <td className={estiloCelula}>{formatarSegundos(atv?.cam_s ?? 0)}</td>
              <td className={estiloCelula}>{atv?.msgs ? atv.msgs : "—"}</td>
              <td className={estiloCelula}>{nota === null ? "—" : <Selo cor={interagiu(nota) ? "ok" : "neutro"}>{nota}</Selo>}</td>
              <td className={estiloCelula}>
                <div className="flex flex-wrap gap-1">
                  {(avisosPorInscricao.get(i.id) ?? []).map((a) => {
                    const corAviso = COR_AVISO[a.status] ?? "neutro";
                    const quando = a.enviado_em ?? a.proxima_em ?? a.created_at;
                    return (
                      <span key={`${a.destino}:${a.evento}`} title={`${a.destino === "disparo" ? "API oficial: " : ""}${ROTULO_STATUS_AVISO[a.status] ?? a.status} — ${formatarDataHora(new Date(quando), FUSO)}`}>
                        <Selo cor={corAviso}>{ROTULO_EVENTO_CURTO[a.evento as NomeEvento] ?? a.evento}{a.destino === "disparo" ? " · API" : ""}</Selo>
                      </span>
                    );
                  })}
                </div>
              </td>
              {mexeHorarios && (
                <td className={estiloCelula}>
                  {i.status === "agendado" && <TrocarHorario inscricaoId={i.id} nome={i.nome} sessaoAtual={s.id} sessoes={outrasSessoes} />}
                </td>
              )}
            </tr>
          );
        })}
      </Tabela>
      {resumo && resumo.estado !== "sem_transcricao" && <CartaoResumo sessaoId={s.id} resumo={resumo} />}
    </Pagina>
  );
}

const ESTADO_RESUMO: Record<EstadoResumoCall, string> = {
  sem_transcricao: "",
  aguardando: "O resumo sai depois que a call terminar e a presença for conferida.",
  pendente: "O resumo está sendo feito. Volte em alguns minutos.",
  pronto: "",
  sem_fala: "A call teve menos de 3 minutos de conversa, então não deu resumo.",
  falhou: "O resumo automático falhou. Baixe a transcrição pra ver a conversa.",
};

/** Resumo do que foi alinhado (o mesmo texto que foi pro card do CRM), com "Copiar" e a transcrição em .txt. */
function CartaoResumo({ sessaoId, resumo }: { sessaoId: string; resumo: Awaited<ReturnType<typeof resumoDaSessao>> }) {
  const texto = resumo.resumo?.texto;
  return (
    <Cartao
      titulo="Resumo da call"
      className="mt-6"
      ajuda="O que foi alinhado na call, escrito pela IA a partir da transcrição. É o mesmo texto que vai pro card do lead no CRM."
      acao={
        <div className="flex items-center gap-2">
          {texto && <BotaoCopiar texto={texto} rotulo="Copiar resumo" formato="botao" />}
          <BotaoLink href={`/api/sessoes/${sessaoId}/transcricao`} variante="secundario">Baixar transcrição</BotaoLink>
        </div>
      }
    >
      {texto ? (
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-texto">{texto}</pre>
      ) : (
        <p className="text-sm text-texto-2">{ESTADO_RESUMO[resumo.estado]}</p>
      )}
      {resumo.resumo && (
        <p className="mt-3 text-xs text-texto-2">
          Feito em {formatarDataHora(new Date(resumo.resumo.gerado_em), FUSO)} com a transcrição {resumo.resumo.origem === "cloudflare" ? "completa (depois da call)" : "do ao vivo"}.
        </p>
      )}
    </Cartao>
  );
}

