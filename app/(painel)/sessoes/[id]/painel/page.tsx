import { notFound, redirect } from "next/navigation";
import { ArrowLeft, TrendingDown, Users } from "lucide-react";
import { lerResumo, lerRetencao } from "@/src/lib/dashboard";
import { formatarSegundos, type AtividadeLead } from "@/src/lib/regras/atividade";
import { duracaoDaRetencao, formatarReais, leadNaSessao } from "@/src/lib/regras/dashboard";
import { formatarSessao } from "@/src/lib/regras/fuso";
import { pode } from "@/src/lib/regras/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { exigirAcessoSessao } from "@/src/lib/acesso";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { CartoesFunil, GraficoFunil, Indicadores } from "../../../_componentes/dashboard/cartoes";
import { GraficoRetencao } from "../../../_componentes/dashboard/graficos";
import { NotaSelo } from "../../../_componentes/dashboard/nota-selo";
import { BotaoLink, Cartao, Pagina, Selo, Tabela, Vazio, estiloCelula, type CorSelo } from "../../../_componentes/ui";

export const dynamic = "force-dynamic";
const FUSO = "America/Sao_Paulo";
const SITUACAO: Record<string, [CorSelo, string]> = { veio: ["ok", "Veio"], agendado: ["destaque", "Agendou"], compareceu: ["ok", "Veio"], faltou: ["erro", "Faltou"] };

type Presenca = { inscricao_id: string; entrou_em: string; saiu_em: string | null };

/** Painel de uma sessão: os mesmos cartões do Início só desta sessão, a retenção e a tabela por lead. Minutos, "veio"
 *  e nota de cada lead seguem a regra do SQL `dashboard_linhas` (ver `leadNaSessao`), pra a tabela bater com os
 *  cartões. Inscrições canceladas ficam de fora, como no SQL. Precisa da permissão `dashboard` (sem ela volta pra
 *  sessão); sem `receita`, some o que é de venda. Abre também pra quem tem `todas_agendas` (só leitura). */
export default async function PainelSessao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eu = await exigirAcessoSessao(id);
  if (!pode(eu, "dashboard")) redirect(`/sessoes/${id}`);
  const verReceita = pode(eu, "receita");
  const db = await dbUsuario();
  const { data: s } = await db.from("sessoes").select("id, inicio, status, titulo, agendas(nome, duracao_min)").eq("id", id).maybeSingle();
  if (!s) notFound();
  const agenda = s.agendas as unknown as { nome: string; duracao_min: number } | null;
  const duracaoMin = agenda?.duracao_min ?? 0;
  const nome = s.titulo ?? agenda?.nome ?? "Sessão";
  const agora = new Date();

  const [resumo, retencao, { data: inscritos }, { data: presencas }, { data: atividades }] = await Promise.all([
    lerResumo(db, { de: null, ate: null, agenda: null, sessao: id }),
    lerRetencao(db, id),
    db.from("inscricoes").select("id, nome, status, minutos_na_sala, created_at").eq("sessao_id", id).neq("status", "cancelado").order("created_at"),
    db.from("presencas").select("inscricao_id, entrou_em, saiu_em").eq("sessao_id", id),
    db.from("atividade_lead").select("inscricao_id, mic_s, cam_s, msgs").eq("sessao_id", id),
  ]);
  const ids = (inscritos ?? []).map((i) => i.id as string);
  // Vendas pela service role (a tabela guarda o contato do comprador e some pro membro sem `contato_lead`), só com
  // `receita` e só das inscrições desta sessão (acesso já conferido acima).
  const { data: vendas } = ids.length && verReceita
    ? await dbAdmin().from("vendas").select("inscricao_id, valor_centavos").eq("status", "aprovada").in("inscricao_id", ids)
    : { data: [] as { inscricao_id: string; valor_centavos: number }[] };

  const presencasPor = new Map<string, Presenca[]>();
  for (const p of (presencas ?? []) as Presenca[]) presencasPor.set(p.inscricao_id, [...(presencasPor.get(p.inscricao_id) ?? []), p]);
  const atividadePor = new Map<string, AtividadeLead>((atividades ?? []).map((a) => [a.inscricao_id as string, a as AtividadeLead]));
  const receitaPor = new Map<string, number>();
  for (const v of vendas ?? []) receitaPor.set(v.inscricao_id as string, (receitaPor.get(v.inscricao_id as string) ?? 0) + Number(v.valor_centavos));

  const linhas = (inscritos ?? []).map((i) => {
    const ps = presencasPor.get(i.id) ?? [];
    const atv = atividadePor.get(i.id);
    const { veio, minutos, nota } = leadNaSessao({ status: i.status, presencas: ps, inicio: new Date(s.inicio), duracaoMin, agora, minutosNaSala: i.minutos_na_sala, atividade: atv });
    return { id: i.id as string, nome: i.nome as string, situacao: veio ? "veio" : (i.status as string), veio, minutos, atv, nota, receita: receitaPor.get(i.id) };
  });
  // Quem veio primeiro, pela nota; depois quem não veio, na ordem de inscrição.
  linhas.sort((a, b) => Number(b.veio) - Number(a.veio) || (b.nota ?? 0) - (a.nota ?? 0));

  return (
    <Pagina
      titulo={`Painel · ${nome}`}
      subtitulo={formatarSessao(new Date(s.inicio), FUSO)}
      trilha={[{ rotulo: "Início", href: "/" }, { rotulo: "Sessões", href: "/sessoes" }, { rotulo: nome, href: `/sessoes/${id}` }, { rotulo: "Painel" }]}
      acoes={<BotaoLink href={`/sessoes/${id}`} variante="secundario" icone={<ArrowLeft />}>Voltar pra sessão</BotaoLink>}
    >
      <CartoesFunil resumo={resumo} verReceita={verReceita} />
      <Indicadores resumo={resumo} verReceita={verReceita} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Cartao titulo="Retenção" icone={TrendingDown} ajuda="Pessoas na sala a cada minuto. A linha tracejada é o fim previsto pela duração da agenda.">
          {retencao.some((p) => p.presentes > 0) ? (
            <GraficoRetencao pontos={retencao} duracao={duracaoDaRetencao(retencao)} />
          ) : (
            <Vazio compacto texto="Ninguém entrou na sala ainda." />
          )}
        </Cartao>
        <GraficoFunil resumo={resumo} verReceita={verReceita} />
      </div>
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-texto-2"><Users size={16} className="text-marca-forte" aria-hidden />Leads</h2>
        <Tabela colunas={["Nome", "Situação", "Minutos", "Microfone", "Câmera", "Mensagens", "Interação", ...(verReceita ? ["Comprou"] : [])]} vazio={linhas.length ? undefined : "Ninguém inscrito nesta sessão."}>
          {linhas.map((l) => {
            const [cor, rotulo] = SITUACAO[l.situacao] ?? ["neutro", l.situacao];
            return (
              <tr key={l.id}>
                <td className={estiloCelula}>{l.nome}</td>
                <td className={estiloCelula}><Selo cor={cor}>{rotulo}</Selo></td>
                <td className={`${estiloCelula} tabular-nums`}>{l.veio && l.minutos ? `${l.minutos} min` : "—"}</td>
                <td className={`${estiloCelula} tabular-nums`}>{formatarSegundos(l.atv?.mic_s ?? 0)}</td>
                <td className={`${estiloCelula} tabular-nums`}>{formatarSegundos(l.atv?.cam_s ?? 0)}</td>
                <td className={`${estiloCelula} tabular-nums`}>{l.atv?.msgs ? l.atv.msgs : "—"}</td>
                <td className={estiloCelula}>{l.nota === null ? "—" : <NotaSelo nota={l.nota} />}</td>
                {verReceita && <td className={`${estiloCelula} tabular-nums`}>{l.receita !== undefined ? formatarReais(l.receita) : "—"}</td>}
              </tr>
            );
          })}
        </Tabela>
      </section>
    </Pagina>
  );
}
