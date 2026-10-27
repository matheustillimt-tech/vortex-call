import Link from "next/link";
import { listarSessoes } from "@/src/lib/api/sessoes";
import { siteUrl } from "@/src/lib/env";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { BotaoCopiar } from "../_componentes/copiar";
import { BotaoLink, Pagina, Selo, Tabela, estiloCelula } from "../_componentes/ui";
import { AgendarPessoa, type SessaoOpcao } from "./agendar-pessoa";

export const dynamic = "force-dynamic";

export default async function Agendas() {
  await exigirAdmin();
  const db = await dbUsuario();
  const { data } = await db.from("agendas").select("id, nome, slug, vagas_padrao, duracao_min, ativa, responsavel:usuarios!agendas_responsavel_id_fkey(nome)").order("nome");
  const agendas = data ?? [];
  // Sessões agendadas dos próximos 14 dias, por agenda, pro "Agendar pessoa" (painel não aplica a janela de dias).
  const porAgenda = new Map<string, SessaoOpcao[]>();
  // Pelo servidor (a página já exige admin): a contagem `inscricoes(count)` do listarSessoes precisa do grant da tabela
  // inteira, que o login da equipe não tem (grant por coluna) — pelo login a página quebrava.
  for (const s of await listarSessoes(dbAdmin(), {})) {
    if (s.status !== "agendada" || !s.agenda) continue;
    const lista = porAgenda.get(s.agenda) ?? [];
    lista.push({ id: s.id, texto: s.inicio_texto, vagas: s.vagas, inscritos: s.inscritos });
    porAgenda.set(s.agenda, lista);
  }
  const site = siteUrl();
  return (
    <Pagina titulo="Agendas" acoes={<BotaoLink href="/agendas/nova">Nova agenda</BotaoLink>}>
      <Tabela colunas={["Nome", "Endereço", "Responsável", "Vagas", "Duração", "Situação", ""]} vazio={agendas.length ? undefined : "Nenhuma agenda ainda."}>
        {agendas.map((a) => (
          <tr key={a.id}>
            <td className={estiloCelula}><Link className="font-medium text-marca" href={`/agendas/${a.id}`}>{a.nome}</Link></td>
            <td className={estiloCelula}>/agendar/{a.slug}</td>
            <td className={estiloCelula}>{(a.responsavel as unknown as { nome: string } | null)?.nome ?? <span className="text-texto-3">—</span>}</td>
            <td className={estiloCelula}>{a.vagas_padrao}</td>
            <td className={estiloCelula}>{a.duracao_min} min</td>
            <td className={estiloCelula}><Selo cor={a.ativa ? "ok" : "neutro"}>{a.ativa ? "Ativa" : "Desativada"}</Selo></td>
            <td className={estiloCelula}>
              <div className="flex justify-end gap-2">
                <BotaoCopiar texto={`${site}/agendar/${a.slug}`} rotulo="Copiar link de agendamento" />
                {a.ativa && <AgendarPessoa agendaId={a.id} agendaNome={a.nome} sessoes={porAgenda.get(a.slug) ?? []} />}
              </div>
            </td>
          </tr>
        ))}
      </Tabela>
    </Pagina>
  );
}
