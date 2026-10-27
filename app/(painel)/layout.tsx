import type { Metadata } from "next";
import { exigirUsuario, membroAtual } from "@/src/lib/supabase/usuario";
import { Menu } from "./_componentes/menu";
import { ProvedorToast } from "./_componentes/toast";
import pacote from "@/package.json";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const usuario = await exigirUsuario();
  const membro = await membroAtual();
  if (!membro) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-fundo p-6 text-center text-sm text-texto-2">
        <p>Seu acesso ({usuario.email}) ainda não foi liberado. Fale com um administrador do sistema.</p>
      </main>
    );
  }
  return (
    <ProvedorToast>
      <div className="min-h-screen bg-fundo text-sm text-texto pn-md:flex">
        <Menu papel={membro.papel} nome={membro.nome} email={usuario.email ?? ""} versao={pacote.version} permissoes={membro.permissoes} />
        <main className="min-w-0 flex-1 px-6 py-7 pn-md:pl-12">{children}</main>
      </div>
    </ProvedorToast>
  );
}
