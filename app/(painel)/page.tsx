import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ChartColumn, Gauge, TrendingDown } from "lucide-react";
import { membroSemAgenda } from "@/src/lib/acesso";
import { lerResumo, lerRetencao, lerSessoes, lerVendedores } from "@/src/lib/dashboard";
import { SEM_AGENDA_DETALHE, SEM_AGENDA_TEXTO } from "@/src/lib/regras/acesso";
import {
  diasDoIntervalo,
  duracaoDaRetencao,
  filtrosDashboardDe,
  formatarMinutosMedios,
  formatarPercentual,
  formatarReais,
  intervaloDoPeriodo,
  rotuloCurtoSessao,
  sessaoDaRetencao,
  ultimasSessoesCronologicas,
} from "@/src/lib/regras/dashboard";
import { formatarSessao } from "@/src/lib/regras/fuso";
import { pode } from "@/src/lib/regras/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { inscritosPorSessao } from "@/src/lib/avisos-equipe";
import { dbUsuario, exigirMembro } from "@/src/lib/supabase/usuario";
import { CartoesFunil, GraficoFunil, Indicadores } from "./_componentes/dashboard/cartoes";
import { FiltrosDashboardBarra } from "./_componentes/dashboard/filtros";
import { GraficoInscritosVieram, GraficoNotas, GraficoRetencao } from "./_componentes/dashboard/graficos";
import { NotaSelo } from "./_componentes/dashboard/nota-selo";
import { TabelaVendedores } from "./_componentes/dashboard/vendedores";
import { BotaoLink, Cartao, Pagina, Tabela, Vazio, estiloCelula, estiloLinhaMarca } from "./_componentes/ui";

export const dynamic = "force-dynamic";
const FUSO = "America/Sao_Paulo";

export default async function Inicio({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const eu = await exigirMembro();
  // Sem a permissão `dashboard`, o Início não existe pra ele (o banco também recusa as funções do dashboard).
  if (!pode(eu, "dashboard")) redirect("/sessoes");
  const admin = eu.papel === "admin";
  // `receita`: cartões/colunas de receita e vendas (sem ela o banco devolve esses números nulos).
  const verReceita = pode(eu, "receita");
  // `todas_agendas`: o banco recorta como o admin (todas as agendas, só leitura) e devolve todos os vendedores.
  const todas = pode(eu, "todas_agendas");
  const db = await dbUsuario();
  if (await membroSemAgenda(eu, db)) {
    return (
      <Pagina titulo="Início">
        <Cartao><Vazio comIcone texto={SEM_AGENDA_TEXTO} detalhe={SEM_AGENDA_DETALHE} /></Cartao>
      </Pagina>
    );
  }
  // Membro: o banco já recorta pelas agendas dele (o filtro de vendedor é só do admin).
  const filtros = { ...filtrosDashboardDe(await searchParams), ...(admin ? {} : { vendedor: null }) };
  const agora = new Date();
  const intervalo = intervaloDoPeriodo(filtros, agora);
  const base = { de: intervalo.de, ate: intervalo.ate, agenda: filtros.agenda, vendedor: filtros.vendedor };

  // Lista do período sem o filtro de sessão (alimenta o seletor); tabela e gráficos usam a sessão escolhida, se houver.
  const [resumo, todasSessoes, vendedores, { data: agendas }, { data: equipe }, { data: proximas }] = await Promise.all([
    lerResumo(db, { ...base, sessao: filtros.sessao }),
    lerSessoes(db, { ...base, sessao: null }),
    lerVendedores(db, base),
    db.from("agendas").select("id, nome").order("nome"),
    admin ? db.from("usuarios").select("id, nome").eq("ativo", true).order("nome") : Promise.resolve({ data: null }),
    // Inclui a que está acontecendo (ao vivo, ou agendada que começou há menos de 1 h) pra dar pra entrar daqui.
    db.from("sessoes").select("id, inicio, vagas, titulo, status, agendas(nome, responsavel_id)").in("status", ["agendada", "ao_vivo"]).gte("inicio", new Date(agora.getTime() - 60 * 60_000).toISOString()).order("inicio").limit(5),
  ]);
  const inscritosProximas = await inscritosPorSessao(dbAdmin(), (proximas ?? []).map((s) => s.id));
  const sessoes = filtros.sessao ? todasSessoes.filter((s) => s.id === filtros.sessao) : todasSessoes;
  const idRetencao = sessaoDaRetencao(sessoes, filtros.sessao);
  const retencao = idRetencao ? await lerRetencao(db, idRetencao) : [];
  const sessaoRetencao = todasSessoes.find((s) => s.id === idRetencao);
  const doGrafico = ultimasSessoesCronologicas(sessoes, 12).map((s) => ({ ...s, rotulo: rotuloCurtoSessao(s.inicio) }));
  const nomeSessao = (s: { titulo: string | null; agenda: string }) => s.titulo ?? s.agenda;
  const vazio = sessoes.length === 0;

  return (
    <Pagina titulo="Início">
      <FiltrosDashboardBarra
        filtros={filtros}
        agendas={(agendas ?? []) as { id: string; nome: string }[]}
        sessoes={todasSessoes.map((s) => ({ id: s.id, rotulo: `${rotuloCurtoSessao(s.inicio)} · ${nomeSessao(s)}` }))}
        diasAtuais={diasDoIntervalo(intervalo)}
        vendedores={admin ? ((equipe ?? []) as { id: string; nome: string }[]) : undefined}
      />

      {vazio ? (
        <Cartao>
          <Vazio
            comIcone
            texto="Ainda não há calls neste período."
            detalhe="Escolha outro período ou marque uma sessão. Os números aparecem assim que as pessoas se inscrevem."
            acao={<BotaoLink href="/sessoes" variante="secundario" icone={<CalendarDays />}>Ver sessões</BotaoLink>}
          />
        </Cartao>
      ) : (
        <>
          <CartoesFunil resumo={resumo} verReceita={verReceita} />
          <Indicadores resumo={resumo} verReceita={verReceita} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <GraficoFunil resumo={resumo} verReceita={verReceita} />
            <Cartao titulo="Inscritos e presentes por sessão" icone={ChartColumn} ajuda="Até as 12 sessões mais recentes do filtro, em ordem de data.">
              <GraficoInscritosVieram itens={doGrafico} />
            </Cartao>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Cartao
              titulo={sessaoRetencao ? `Retenção · ${rotuloCurtoSessao(sessaoRetencao.inicio)} · ${nomeSessao(sessaoRetencao)}` : "Retenção"}
              icone={TrendingDown}
              ajuda="Pessoas na sala a cada minuto da sessão escolhida no filtro (ou a mais recente com público). A linha tracejada é o fim previsto pela duração da agenda."
            >
              {retencao.some((p) => p.presentes > 0) ? (
                <GraficoRetencao pontos={retencao} duracao={duracaoDaRetencao(retencao)} />
              ) : (
                <Vazio compacto texto="Ninguém entrou na sala ainda." detalhe="A retenção aparece depois da primeira sessão com público." />
              )}
            </Cartao>
            <Cartao titulo="Nota média de interação por sessão" icone={Gauge} ajuda="De 0 a 100, só de quem veio. A linha vermelha tracejada marca 30 (interagiu).">
              <GraficoNotas itens={doGrafico.map((s) => ({ id: s.id, rotulo: s.rotulo, nota: s.nota_media, vieram: s.vieram }))} />
            </Cartao>
          </div>

          <TabelaVendedores linhas={vendedores} titulo={admin || todas ? "Vendedores" : "Seus resultados"} verReceita={verReceita} />

          <Tabela colunas={["Quando", "Agenda", "Anfitrião", "Inscritos", "Vieram", "Tempo médio", "Interação", ...(verReceita ? ["Vendas", "Receita"] : [])]}>
            {sessoes.map((s) => (
              <tr key={s.id} className={estiloLinhaMarca}>
                <td className={estiloCelula}>
                  <Link className="font-medium text-marca hover:underline" href={`/sessoes/${s.id}/painel`}>{formatarSessao(new Date(s.inicio), FUSO)}</Link>
                </td>
                <td className={estiloCelula}>{nomeSessao(s)}</td>
                <td className={estiloCelula}>{s.anfitriao ?? <span className="text-texto-3">—</span>}</td>
                <td className={`${estiloCelula} tabular-nums`}>{s.inscritos}</td>
                <td className={`${estiloCelula} tabular-nums`}>{s.vieram} <span className="text-texto-3">({formatarPercentual(s.vieram, s.inscritos)})</span></td>
                <td className={`${estiloCelula} tabular-nums`}>{formatarMinutosMedios(s.minutos_medios)}</td>
                <td className={estiloCelula}>{s.vieram > 0 ? <NotaSelo nota={s.nota_media} /> : "—"}</td>
                {verReceita && (
                  <>
                    <td className={`${estiloCelula} tabular-nums`}>{s.compraram || "—"}</td>
                    <td className={`${estiloCelula} tabular-nums`}>{s.receita_centavos > 0 ? formatarReais(s.receita_centavos) : "—"}</td>
                  </>
                )}
              </tr>
            ))}
          </Tabela>
        </>
      )}

      <Cartao titulo="Próximas sessões" icone={CalendarDays} className="p-4" acao={<Link className="text-sm text-marca hover:underline" href="/sessoes">Ver todas</Link>}>
        {(proximas ?? []).length === 0 ? (
          <p className="text-sm text-texto-3">Nenhuma sessão marcada.</p>
        ) : (
          <ul className="grid gap-1.5 text-sm">
            {(proximas ?? []).map((s) => (
              <li key={s.id} className="flex justify-between gap-3">
                <Link className="min-w-0 truncate text-marca hover:underline" href={`/sessoes/${s.id}`}>
                  {formatarSessao(new Date(s.inicio), FUSO)} · {s.titulo ?? (s.agendas as unknown as { nome: string } | null)?.nome}
                </Link>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="tabular-nums text-texto-3">{inscritosProximas.get(s.id) ?? 0} / {s.vagas}</span>
                  {pode(eu, "anfitriao") && (eu.papel === "admin" || (s.agendas as unknown as { responsavel_id: string | null } | null)?.responsavel_id === eu.id) && (
                    <Link className="font-medium text-marca hover:underline" href={`/equipe/sala/${s.id}?modo=anfitriao`}>{s.status === "ao_vivo" ? "Entrar (ao vivo)" : "Entrar"}</Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </Pagina>
  );
}
