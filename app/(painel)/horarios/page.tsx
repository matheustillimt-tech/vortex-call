import { membroSemAgenda } from "@/src/lib/acesso";
import { SEM_AGENDA_DETALHE, SEM_AGENDA_TEXTO } from "@/src/lib/regras/acesso";
import { pode } from "@/src/lib/regras/permissoes";
import { dbUsuario, exigirMembro } from "@/src/lib/supabase/usuario";
import { SemPermissao } from "../_componentes/sem-permissao";
import { Cartao, Pagina, Selo, Tabela, Vazio, estiloCelula } from "../_componentes/ui";
import { BotaoPararRepeticao } from "../sessoes/gerir";
import { NovaSessao } from "../sessoes/nova";

export const dynamic = "force-dynamic";
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function formatarData(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Horários que se repetem toda semana (repetições). Admin vê os de todas as agendas; o responsável (membro), só os
 *  das agendas dele (RLS). Os dois criam e param; as sessões das próximas 4 semanas nascem sozinhas (cron). Membro sem
 *  a permissão `horarios` não abre; com `todas_agendas` vê os das outras agendas, mas só mexe nos dele. */
export default async function Horarios() {
  const eu = await exigirMembro();
  if (!pode(eu, "horarios")) return <SemPermissao titulo="Horários" />;
  const db = await dbUsuario();
  if (await membroSemAgenda(eu, db)) {
    return (
      <Pagina titulo="Horários">
        <Cartao><Vazio comIcone texto={SEM_AGENDA_TEXTO} detalhe={SEM_AGENDA_DETALHE} /></Cartao>
      </Pagina>
    );
  }
  const [{ data: repeticoes }, { data: agendas }] = await Promise.all([
    db.from("repeticoes").select("id, dias_semana, hora, vagas, ate, ativa, agendas(nome, responsavel_id)").order("ativa", { ascending: false }).order("hora"),
    db.from("agendas").select("id, nome, vagas_padrao, responsavel_id").eq("ativa", true).order("nome"),
  ]);
  const gere = (responsavel: string | null | undefined) => eu.papel === "admin" || responsavel === eu.id;
  const minhas = (agendas ?? []).filter((a) => gere(a.responsavel_id as string | null));
  return (
    <Pagina titulo="Horários" acoes={minhas.length ? <NovaSessao agendas={minhas} tipoInicial="semanal" rotulo="Novo horário" /> : null}>
      <Tabela
        colunas={["Agenda", "Dias", "Hora (Brasília)", "Vagas", "Até", "Situação", ""]}
        vazio={repeticoes?.length ? undefined : "Nenhum horário que se repete."}
        vazioDetalhe="Crie um em “Novo horário”: as sessões das próximas 4 semanas aparecem sozinhas em Sessões."
      >
        {(repeticoes ?? []).map((r) => (
          <tr key={r.id}>
            <td className={`${estiloCelula} font-medium`}>{(r.agendas as unknown as { nome: string } | null)?.nome ?? "—"}</td>
            <td className={estiloCelula}>{(r.dias_semana as number[]).slice().sort().map((d) => DIAS[d]).join(", ")}</td>
            <td className={estiloCelula}>{r.hora}</td>
            <td className={estiloCelula}>{r.vagas}</td>
            <td className={estiloCelula}>{r.ate ? formatarData(r.ate as string) : "Sem fim"}</td>
            <td className={estiloCelula}><Selo cor={r.ativa ? "ok" : "neutro"}>{r.ativa ? "Ativo" : "Parado"}</Selo></td>
            <td className={`${estiloCelula} text-right`}>
              {r.ativa && gere((r.agendas as unknown as { responsavel_id: string | null } | null)?.responsavel_id) && <BotaoPararRepeticao id={r.id} />}
            </td>
          </tr>
        ))}
      </Tabela>
    </Pagina>
  );
}
