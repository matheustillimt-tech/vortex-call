import { notFound } from "next/navigation";
import { formatarDataHora } from "@/src/lib/regras/fuso";
import { ROTULO_EVENTO, type NomeEvento } from "@/src/lib/regras/eventos";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Botao, Pagina, Selo, Tabela, estiloCelula, type CorSelo } from "../../../_componentes/ui";
import { tentarDeNovo } from "../../actions";

export const dynamic = "force-dynamic";
const FUSO = "America/Sao_Paulo";

const COR_STATUS: Record<string, CorSelo> = { enviado: "ok", pendente: "aviso", falhou: "erro", sem_destino: "neutro" };
const ROTULO_STATUS: Record<string, string> = { enviado: "Enviado", pendente: "Pendente", falhou: "Falhou", sem_destino: "Sem destino" };

export default async function AvisosDaAgenda({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();
  const { data: agenda } = await db.from("agendas").select("nome").eq("id", id).maybeSingle();
  if (!agenda) notFound();

  // Pela service role (já conferido que é admin): a resposta do CRM pode ter o contato do lead e não sai mais pelo
  // cliente da equipe (migração 20261024120000_permissoes.sql).
  const { data: eventos } = await dbAdmin()
    .from("eventos")
    .select("id, evento, destino, status, tentativas, resposta_status, resposta, created_at, inscricoes(nome)")
    .eq("agenda_id", id)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <Pagina titulo="Avisos" trilha={[{ rotulo: "Agendas", href: "/agendas" }, { rotulo: agenda.nome, href: `/agendas/${id}` }, { rotulo: "Avisos" }]}>
      <Tabela colunas={["Quando", "Aviso", "Lead", "Situação", "Tentativas", "Resposta", ""]} vazio={eventos?.length ? undefined : "Sem eventos ainda."}>
        {(eventos ?? []).map((e) => {
          const lead = (e.inscricoes as unknown as { nome: string } | null)?.nome ?? "—";
          const resposta = [e.resposta_status, e.resposta ? e.resposta.slice(0, 80) : null].filter((v) => v !== null && v !== undefined).join(" — ");
          const cor = COR_STATUS[e.status] ?? "neutro";
          return (
            <tr key={e.id}>
              <td className={estiloCelula}>{formatarDataHora(new Date(e.created_at), FUSO)}</td>
              <td className={estiloCelula}>
                {ROTULO_EVENTO[e.evento as NomeEvento] ?? e.evento}
                {e.destino === "disparo" && <span className="text-texto-2"> · API oficial</span>}
              </td>
              <td className={estiloCelula}>{lead}</td>
              <td className={estiloCelula}>
                <Selo cor={cor}>{ROTULO_STATUS[e.status] ?? e.status}</Selo>
              </td>
              <td className={estiloCelula}>{e.tentativas}</td>
              <td className={estiloCelula}>{resposta || "—"}</td>
              <td className={estiloCelula}>
                {e.status === "falhou" && (
                  <form action={tentarDeNovo.bind(null, e.id)}>
                    <Botao variante="secundario" tamanho="pequeno" type="submit">
                      Tentar de novo
                    </Botao>
                  </form>
                )}
              </td>
            </tr>
          );
        })}
      </Tabela>
    </Pagina>
  );
}
