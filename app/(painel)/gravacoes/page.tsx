import { SEM_DEPENDENCIAS } from "@/src/lib/api/excluir";
import { listarGravacoes, type GravacaoApi } from "@/src/lib/api/gravacoes";
import { r2Config } from "@/src/lib/r2";
import { formatarDataHora } from "@/src/lib/regras/fuso";
import { inicioDoPeriodo, periodoGravacoesDe, PERIODOS_GRAVACOES, type PeriodoGravacoes } from "@/src/lib/regras/periodo-gravacoes";
import { pode } from "@/src/lib/regras/permissoes";
import { dbUsuario, exigirMembro } from "@/src/lib/supabase/usuario";
import { SemPermissao } from "../_componentes/sem-permissao";
import { BotaoExcluir } from "../_componentes/excluir";
import { estiloCelula, estiloSegmento, estiloSegmentos, Pagina, Selo, Tabela, type CorSelo } from "../_componentes/ui";
import { AcoesGravacao } from "./acoes";
import { excluirGravacaoAction } from "./actions";

export const dynamic = "force-dynamic";
const FUSO = "America/Sao_Paulo";

const ROTULO_PERIODO: Record<PeriodoGravacoes, string> = { "7dias": "Últimos 7 dias", "24h": "Últimas 24h", hoje: "Hoje" };

const SITUACAO: Record<string, { rotulo: string; cor: CorSelo }> = {
  RECORDING: { rotulo: "Gravando", cor: "destaque" },
  UPLOADING: { rotulo: "Processando", cor: "aviso" },
  UPLOADED: { rotulo: "Pronta", cor: "ok" },
  ERRORED: { rotulo: "Erro", cor: "erro" },
};

function situacaoDe(g: GravacaoApi): { rotulo: string; cor: CorSelo } {
  if (g.expirada) return { rotulo: "Expirada", cor: "neutro" };
  return SITUACAO[g.status] ?? { rotulo: "Processando", cor: "aviso" };
}

function duracao(s: number | null): string {
  if (s === null) return "—";
  const m = Math.floor(s / 60);
  const seg = Math.floor(s % 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}min` : `${m}:${String(seg).padStart(2, "0")}`;
}

function disponivelAte(g: GravacaoApi): string {
  if (g.armazenamento === "r2") return "Guardada (R2)";
  return g.expirada || !g.disponivel_ate ? "—" : formatarDataHora(new Date(g.disponivel_ate), FUSO);
}

export default async function Gravacoes({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const eu = await exigirMembro();
  // Sem `gravacoes`: não abre (a RLS também esconde as gravações e o link recusa com 403).
  if (!pode(eu, "gravacoes")) return <SemPermissao titulo="Gravações" />;
  const periodo = periodoGravacoesDe((await searchParams).periodo);
  const db = await dbUsuario();
  const agora = new Date();
  const gravacoes = await listarGravacoes(db, { de: inicioDoPeriodo(periodo, agora) }, agora);
  const semR2 = !r2Config();
  const podeExcluir = eu.papel === "admin";

  return (
    <Pagina titulo="Gravações">
      <div role="tablist" aria-label="Período" className={estiloSegmentos}>
        {PERIODOS_GRAVACOES.map((p) => (
          <a key={p} role="tab" aria-selected={p === periodo} href={`/gravacoes?periodo=${p}`} className={estiloSegmento(p === periodo)}>
            {ROTULO_PERIODO[p]}
          </a>
        ))}
      </div>

      {semR2 && <p className="text-sm text-texto-3">Gravações na Cloudflare: ficam 7 dias.</p>}

      <Tabela
        colunas={["Quando", "Origem", "Duração", "Situação", "Disponível até", ""]}
        vazio={gravacoes.length ? undefined : "Nenhuma gravação nesse período."}
        vazioDetalhe={gravacoes.length || !semR2 ? undefined : "A Cloudflare guarda as gravações por 7 dias."}
      >
        {gravacoes.map((g) => {
          const situacao = situacaoDe(g);
          return (
            <tr key={g.id}>
              <td className={estiloCelula}>{g.iniciada_em ? formatarDataHora(new Date(g.iniciada_em), FUSO) : "—"}</td>
              <td className={estiloCelula}>{g.origem === "reuniao" ? `Reunião: ${g.titulo}` : g.titulo}</td>
              <td className={estiloCelula}>{duracao(g.duracao_s)}</td>
              <td className={estiloCelula}><Selo cor={situacao.cor}>{situacao.rotulo}</Selo></td>
              <td className={estiloCelula}>{disponivelAte(g)}</td>
              <td className={`${estiloCelula} text-right`}>
                <div className="flex items-center justify-end gap-2">
                  {!g.expirada && situacao.rotulo === "Pronta" && <AcoesGravacao id={g.id} />}
                  {/* Gravação não tem dependência pra mostrar no modal: nada de contar por linha. */}
                  {podeExcluir && (
                    <BotaoExcluir tipo="gravacao" id={g.id} nome={g.titulo} contagens={SEM_DEPENDENCIAS} acao={excluirGravacaoAction} />
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </Tabela>
    </Pagina>
  );
}
