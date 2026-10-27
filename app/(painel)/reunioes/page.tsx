import { dependenciasDasReunioes } from "@/src/lib/api/excluir";
import { siteUrl } from "@/src/lib/env";
import { formatarSessao } from "@/src/lib/regras/fuso";
import { situacaoReuniao, type SituacaoReuniao } from "@/src/lib/regras/reuniao";
import { pode } from "@/src/lib/regras/permissoes";
import { dbUsuario, exigirMembro } from "@/src/lib/supabase/usuario";
import { BotaoExcluir } from "../_componentes/excluir";
import { Pagina, Selo, Tabela, estiloCelula } from "../_componentes/ui";
import { AcoesReuniao, NovaReuniao } from "./acoes";
import { excluirReuniaoAction } from "./actions";

export const dynamic = "force-dynamic";
const FUSO = "America/Sao_Paulo";
const COR = { ativa: "ok", encerrada: "neutro", vencida: "aviso" } as const;
const ROTULO: Record<SituacaoReuniao, string> = { ativa: "Ativa", encerrada: "Encerrada", vencida: "Vencida" };

type Linha = { id: string; codigo: string; titulo: string; created_at: string; encerrada_em: string | null; expira_em: string; usuarios: unknown };

/** Reuniões instantâneas: as ativas primeiro, depois as últimas 30 encerradas ou vencidas. */
export default async function Reunioes() {
  const eu = await exigirMembro();
  const db = await dbUsuario();
  const agora = new Date();
  const campos = "id, codigo, titulo, created_at, encerrada_em, expira_em, usuarios(nome)";
  const [{ data: ativas }, { data: antigas }] = await Promise.all([
    db.from("reunioes").select(campos).is("encerrada_em", null).gt("expira_em", agora.toISOString()).order("created_at", { ascending: false }),
    db.from("reunioes").select(campos).or(`encerrada_em.not.is.null,expira_em.lte."${agora.toISOString()}"`).order("created_at", { ascending: false }).limit(30),
  ]);
  const linhas = [...((ativas ?? []) as Linha[]), ...((antigas ?? []) as Linha[])];
  const base = siteUrl();
  const podeExcluir = eu.papel === "admin";
  // Uma consulta pra todas as linhas (não um contar_dependencias por reunião).
  const contagens = podeExcluir ? await dependenciasDasReunioes(db, linhas.map((r) => r.id)) : null;

  return (
    <Pagina titulo="Reuniões" acoes={pode(eu, "reunioes") ? <NovaReuniao /> : null}>
      <Tabela colunas={["Título", "Criada por", "Criada em", "Situação", ""]} vazio={linhas.length ? undefined : "Nenhuma reunião ainda."}>
        {linhas.map((r) => {
          const situacao = situacaoReuniao(r, agora);
          const autor = (Array.isArray(r.usuarios) ? r.usuarios[0] : r.usuarios) as { nome?: string } | null;
          return (
            <tr key={r.id}>
              <td className={`${estiloCelula} font-medium`}>{r.titulo}</td>
              <td className={estiloCelula}>{autor?.nome ?? "—"}</td>
              <td className={estiloCelula}>{formatarSessao(new Date(r.created_at), FUSO)}</td>
              <td className={estiloCelula}><Selo cor={COR[situacao]}>{ROTULO[situacao]}</Selo></td>
              <td className={estiloCelula}>
                <div className="flex items-center justify-end gap-2">
                  {situacao === "ativa" && <AcoesReuniao codigo={r.codigo} link={`${base}/r/${r.codigo}`} />}
                  {contagens?.has(r.id) && (
                    <BotaoExcluir tipo="reuniao" id={r.id} nome={r.titulo} contagens={contagens.get(r.id)!} acao={excluirReuniaoAction} />
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
