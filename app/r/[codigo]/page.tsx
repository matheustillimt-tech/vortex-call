import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { siteUrl } from "@/src/lib/env";
import { ehCodigoValido } from "@/src/lib/regras/codigo";
import { estadoReuniao, idDaReuniao } from "@/src/lib/reunioes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { membroApi } from "@/src/lib/supabase/usuario";
import { MarcaTopo, Reuniao } from "./reuniao";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reunião", robots: { index: false, follow: false } };

/** Link da reunião instantânea. Membro logado entra direto como anfitrião; pessoa de fora digita o nome. */
export default async function PaginaReuniao({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  if (!ehCodigoValido(codigo)) notFound();
  const estado = await estadoReuniao(codigo);
  if (!estado) notFound();
  const { data: config } = await dbAdmin().from("configuracao").select("nome, logo_url, cor_marca").eq("id", 1).maybeSingle();
  const marca = {
    nome: config?.nome ?? "Vórtex Call",
    logoUrl: (config?.logo_url as string | null) ?? null,
    cor: config?.cor_marca ?? "#0A8452",
  };
  if (estado.estado === "encerrada") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <MarcaTopo marca={marca} />
        <p className="text-lg font-medium text-zinc-800">Essa reunião já terminou.</p>
      </main>
    );
  }
  const membro = await membroApi();
  const reuniaoId = membro ? await idDaReuniao(codigo) : null;
  return (
    <Reuniao
      codigo={codigo}
      titulo={estado.titulo}
      link={`${siteUrl()}/r/${codigo}`}
      marca={marca}
      membro={membro ? { nome: membro.nome } : null}
      reuniaoId={reuniaoId}
    />
  );
}
