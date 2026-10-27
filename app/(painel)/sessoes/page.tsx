import Link from "next/link";
import { membroSemAgenda } from "@/src/lib/acesso";
import { inscritosPorSessao } from "@/src/lib/avisos-equipe";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { SEM_AGENDA_DETALHE, SEM_AGENDA_TEXTO } from "@/src/lib/regras/acesso";
import { rotuloAnfitriao } from "@/src/lib/regras/anfitriao";
import { formatarSessao } from "@/src/lib/regras/fuso";
import { pode } from "@/src/lib/regras/permissoes";
import { dbUsuario, exigirMembro } from "@/src/lib/supabase/usuario";
import { BotaoLink, Cartao, Pagina, Selo, Tabela, Vazio, estiloCelula } from "../_componentes/ui";
import { NovaSessao } from "./nova";

export const dynamic = "force-dynamic";
const FUSO = "America/Sao_Paulo";
const COR = { agendada: "destaque", ao_vivo: "ok", encerrada: "neutro", cancelada: "erro" } as const;
const ROTULO = { agendada: "Agendada", ao_vivo: "Ao vivo", encerrada: "Encerrada", cancelada: "Cancelada" } as const;

export default async function Sessoes() {
  const eu = await exigirMembro();
  const db = await dbUsuario();
  if (await membroSemAgenda(eu, db)) {
    return (
      <Pagina titulo="Sessões">
        <Cartao><Vazio comIcone texto={SEM_AGENDA_TEXTO} detalhe={SEM_AGENDA_DETALHE} /></Cartao>
      </Pagina>
    );
  }
  const agora = new Date();
  const desde = new Date(Date.now() - 2 * 86400_000).toISOString();
  const [{ data: sessoes, error: erroSessoes }, { data: agendas }] = await Promise.all([
    db.from("sessoes").select("id, inicio, vagas, status, titulo, agendas(nome, responsavel_id), anfitriao:usuarios!sessoes_anfitriao_id_fkey(nome)").gte("inicio", desde).order("inicio").limit(200),
    db.from("agendas").select("id, nome, vagas_padrao, responsavel_id").eq("ativa", true).order("nome"),
  ]);
  // Contagem pelo servidor: só ids que a pessoa já vê (RLS acima), e só o número.
  const contagem = await inscritosPorSessao(dbAdmin(), (sessoes ?? []).map((s) => s.id));
  if (erroSessoes) console.error("[sessoes] lista falhou", erroSessoes.code, erroSessoes.message, erroSessoes.details, erroSessoes.hint);
  // "Nova sessão": só com `horarios` e só nas agendas que ele gere (com `todas_agendas` a lista traz as de outros, só
  // pra ler). A action confere de novo.
  const minhas = pode(eu, "horarios") ? (agendas ?? []).filter((a) => eu.papel === "admin" || a.responsavel_id === eu.id) : [];
  return (
    <Pagina titulo="Sessões" acoes={minhas.length ? <NovaSessao agendas={minhas} /> : null}>
      <Tabela colunas={["Quando", "Agenda", "Inscritos", "Anfitrião", "Situação", ""]} vazio={sessoes?.length ? undefined : "Nenhuma sessão nos próximos dias."}>
        {(sessoes ?? []).map((s) => {
          const inscritos = contagem.get(s.id) ?? 0;
          const status = s.status as keyof typeof COR;
          // "Entrar" direto da lista: sessão agendada ou ao vivo, pra quem pode conduzir (admin ou responsável pela agenda,
          // com a permissão de anfitrião). A sala confere de novo.
          const agenda = s.agendas as unknown as { nome: string; responsavel_id: string | null } | null;
          const entra = (status === "agendada" || status === "ao_vivo") && pode(eu, "anfitriao") && (eu.papel === "admin" || agenda?.responsavel_id === eu.id);
          const anfitriao = rotuloAnfitriao({ nome: (s.anfitriao as unknown as { nome: string } | null)?.nome, status: s.status, inicio: s.inicio, agora });
          return (
            <tr key={s.id}>
              <td className={estiloCelula}><Link className="font-medium text-marca" href={`/sessoes/${s.id}`}>{formatarSessao(new Date(s.inicio), FUSO)}</Link></td>
              <td className={estiloCelula}>{s.titulo ?? (s.agendas as unknown as { nome: string } | null)?.nome}</td>
              <td className={estiloCelula}>{inscritos} / {s.vagas}</td>
              <td className={`${estiloCelula} ${anfitriao.aviso ? "text-aviso" : ""}`}>{anfitriao.texto}</td>
              <td className={estiloCelula}><Selo cor={COR[status]}>{ROTULO[status]}</Selo></td>
              <td className={`${estiloCelula} text-right`}>
                {entra && <BotaoLink href={`/equipe/sala/${s.id}?modo=anfitriao`} tamanho="pequeno" variante={status === "ao_vivo" ? "principal" : "secundario"}>Entrar</BotaoLink>}
              </td>
            </tr>
          );
        })}
      </Tabela>
    </Pagina>
  );
}
