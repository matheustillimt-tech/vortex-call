import type { Metadata } from "next";
import { Bot, FileText, KeyRound } from "lucide-react";
import { formatarDataHora } from "@/src/lib/regras/fuso";
import { siteUrl } from "@/src/lib/env";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { exigirAdmin } from "@/src/lib/supabase/usuario";
import { BotaoCopiar } from "../_componentes/copiar";
import { Cartao, estiloCelula, Pagina, Selo, Tabela } from "../_componentes/ui";
import { CriarChave, RevogarChave } from "./formulario";

export const metadata: Metadata = { title: "Integrações · Vórtex Call" };

const FUSO = "America/Sao_Paulo";
const LINK_DOCS = "https://github.com/matheustillimt-tech/vortex-call/blob/main/docs/api.md";

type LinhaChave = { id: string; nome: string; permissao: "leitura" | "escrita"; prefixo: string; ultimo_uso: string | null; revogada_em: string | null; created_at: string };

const data = (iso: string | null) => (iso ? formatarDataHora(new Date(iso), FUSO) : "—");

/** Admin: cria e revoga chaves de acesso (`vc_…`) da API REST e do MCP, e traz o comando pronto pra conectar um
 *  Claude. A tabela `chaves_api` não abre pra RLS: lê com a service role (a página já conferiu que é admin). */
export default async function Integracoes() {
  await exigirAdmin();
  const urlMcp = `${siteUrl()}/api/mcp`;
  const { data: linhas, error } = await dbAdmin()
    .from("chaves_api")
    .select("id, nome, permissao, prefixo, ultimo_uso, revogada_em, created_at")
    .order("created_at", { ascending: false });
  const chaves = (linhas ?? []) as unknown as LinhaChave[];

  return (
    <Pagina titulo="Integrações">
      <div className="space-y-6">
        <Cartao
          titulo="Chaves de acesso"
          icone={KeyRound}
          ajuda="Uma chave por pessoa ou por Claude. A chave aparece uma vez só, na criação. Revogar corta o acesso na hora."
          acao={<CriarChave urlMcp={urlMcp} />}
        >
          {error && <p role="alert" className="mb-4 rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro">Não deu para carregar as chaves. Tente de novo.</p>}
          <Tabela
            colunas={["Nome", "Permissão", "Chave", "Criada em", "Último uso", <span key="a" className="block text-right">Ação</span>]}
            vazio={chaves.length === 0 ? "Nenhuma chave ainda." : undefined}
          >
            {chaves.map((c) => (
              <tr key={c.id} className={c.revogada_em ? "text-texto-3" : ""}>
                <td className={`${estiloCelula} py-3 font-medium`}>
                  <span className="flex flex-wrap items-center gap-2">
                    {c.nome}
                    {c.revogada_em && <Selo cor="neutro">Revogada</Selo>}
                  </span>
                </td>
                <td className={estiloCelula}>{c.permissao === "escrita" ? "Leitura e escrita" : "Só leitura"}</td>
                <td className={`${estiloCelula} font-mono text-xs`}>vc_{c.prefixo}…</td>
                <td className={`${estiloCelula} whitespace-nowrap`}>{data(c.created_at)}</td>
                <td className={`${estiloCelula} whitespace-nowrap`}>{data(c.ultimo_uso)}</td>
                <td className={`${estiloCelula} text-right`}>{!c.revogada_em && <RevogarChave id={c.id} nome={c.nome} />}</td>
              </tr>
            ))}
          </Tabela>
        </Cartao>

        <Cartao titulo="MCP para o Claude" icone={Bot} ajuda="Com a chave, o Claude consulta agendas, sessões, inscritos e gravações, e pode criar sessões e reuniões.">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-suave px-3 py-2 text-sm">{urlMcp}</code>
              <BotaoCopiar texto={urlMcp} rotulo="Copiar endereço" />
            </div>
            <p className="text-sm text-texto-2">Comando pronto (troque SUA_CHAVE pela chave criada acima):</p>
            <pre className="max-h-40 overflow-auto rounded-md bg-suave p-3 text-xs break-all whitespace-pre-wrap">{`claude mcp add --transport http vortex-call ${urlMcp} --header "Authorization: Bearer SUA_CHAVE"`}</pre>
          </div>
        </Cartao>

        <Cartao titulo="API" icone={FileText} ajuda="Referência das rotas REST (/api/v1/*), com exemplo de curl e os campos de cada resposta.">
          <p className="text-sm">
            <a href={LINK_DOCS} target="_blank" rel="noopener noreferrer" className="font-medium text-marca transition-colors hover:text-marca-escura hover:underline">
              {LINK_DOCS}
            </a>
            
          </p>
        </Cartao>
      </div>
    </Pagina>
  );
}
