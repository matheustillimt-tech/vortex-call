import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarcaTopo } from "@/app/r/[codigo]/reuniao";
import { estadoConvite } from "@/src/lib/convite";
import { ehConviteValido } from "@/src/lib/regras/convite";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { Entrada } from "./entrada";
import { TEXTO_AGUARDANDO, TEXTO_TERMINOU } from "./textos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Call", robots: { index: false, follow: false } };

/** Link de convidado da sessão (o anfitrião copia na sala): a pessoa digita o nome e entra como participante, sem
 *  login e sem inscrição, enquanto a sessão está ao vivo. Antes do anfitrião abrir e depois do fim, só o aviso. */
export default async function PaginaConvite({ params }: { params: Promise<{ convite: string }> }) {
  const { convite } = await params;
  if (!ehConviteValido(convite)) notFound();
  const estado = await estadoConvite(convite);
  if (!estado) notFound();
  const { data: config } = await dbAdmin().from("configuracao").select("nome, logo_url, cor_marca").eq("id", 1).maybeSingle();
  const marca = {
    nome: config?.nome ?? "Vórtex Call",
    logoUrl: (config?.logo_url as string | null) ?? null,
    cor: config?.cor_marca ?? "#0A8452",
  };
  if (estado.estado !== "aberta") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <MarcaTopo marca={marca} />
        <p className="max-w-sm text-lg font-medium text-zinc-800">{estado.estado === "encerrada" ? TEXTO_TERMINOU : TEXTO_AGUARDANDO}</p>
        {estado.estado === "aguardando" && (
          <a href={`/s/${convite}`} className="rounded-md px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: marca.cor }}>
            Tentar de novo
          </a>
        )}
      </main>
    );
  }
  return <Entrada codigo={convite} titulo={estado.titulo} marca={marca} />;
}
