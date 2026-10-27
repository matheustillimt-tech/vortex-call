import type { Metadata } from "next";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { estiloCelula, Pagina, Selo, Tabela } from "../_componentes/ui";
import { AcoesPessoa, type Pessoa } from "./acoes";
import { CriarUsuario } from "./formulario";
import { ADMIN_TEM_TUDO } from "@/src/lib/regras/permissoes";

export const metadata: Metadata = { title: "Equipe · Vórtex Call" };

export default async function Usuarios() {
  const eu = await exigirAdmin();
  const db = await dbUsuario();
  const { data, error } = await db.from("usuarios").select("id, nome, email, papel, ativo, whatsapp, permissoes").order("nome");
  const pessoas = (data ?? []) as Pessoa[];

  return (
    <Pagina titulo="Equipe" acoes={<CriarUsuario />}>
      {error && <p role="alert" className="rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro">Não deu para carregar os usuários. Tente de novo.</p>}

      <Tabela
        colunas={["Nome do usuário", "E-mail", "WhatsApp", "Tipo de usuário", <span key="a" className="block text-right">Ação</span>]}
        vazio={pessoas.length === 0 ? "Nenhum usuário ainda." : undefined}
      >
        {pessoas.map((p) => (
          <tr key={p.id} className={p.ativo ? "" : "text-texto-3"}>
            <td className={`${estiloCelula} min-w-[180px] py-3`}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.nome}</span>
                {!p.ativo && <Selo cor="neutro">Desativado</Selo>}
              </span>
            </td>
            <td className={`${estiloCelula} break-all`}>{p.email}</td>
            <td className={`${estiloCelula} whitespace-nowrap`}>{p.whatsapp ?? <span className="text-texto-3">—</span>}</td>
            <td className={`${estiloCelula} whitespace-nowrap`}>
              {p.papel === "admin" ? (
                <>Administrador <span className="block text-xs text-texto-4">{ADMIN_TEM_TUDO}</span></>
              ) : (
                "Membro"
              )}
            </td>
            <td className={estiloCelula}>
              <AcoesPessoa pessoa={p} souEu={p.id === eu.id} />
            </td>
          </tr>
        ))}
      </Tabela>
    </Pagina>
  );
}
