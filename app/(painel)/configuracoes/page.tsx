import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Pagina } from "../_componentes/ui";
import { FormularioConfiguracao } from "./formulario";

export const dynamic = "force-dynamic";

export default async function Configuracoes() {
  await exigirAdmin();
  const db = await dbUsuario();
  const { data } = await db.from("configuracao").select("nome, logo_url, cor_marca, whatsapp_suporte, crm_url_equipe").eq("id", 1).single();
  // O segredo não sai pra equipe nem pro admin (grant por coluna): o servidor só conta se existe.
  const { data: segredo } = await dbAdmin().from("configuracao").select("crm_segredo_equipe").eq("id", 1).maybeSingle();
  return (
    <Pagina titulo="Configurações">
      <FormularioConfiguracao inicial={{ ...data!, temSegredoEquipe: !!segredo?.crm_segredo_equipe }} />
    </Pagina>
  );
}
