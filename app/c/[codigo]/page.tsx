import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ehCodigoValido } from "@/src/lib/regras/codigo";
import { formatarHora } from "@/src/lib/regras/fuso";
import { estadoDaSala } from "@/src/lib/regras/estado-sala";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { Espera } from "./espera";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sua call", robots: { index: false, follow: false } };
const FUSO = "America/Sao_Paulo";

export default async function LinkPessoal({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  if (!ehCodigoValido(codigo)) notFound();
  const db = dbAdmin();
  const { data } = await db
    .from("inscricoes")
    .select("status, sessoes(inicio, status), agendas(slug, duracao_min, abre_antes_min)")
    .eq("codigo", codigo)
    .maybeSingle();
  if (!data) notFound();
  const sessao = data.sessoes as unknown as { inicio: string; status: string };
  const agenda = data.agendas as unknown as { slug: string; duracao_min: number; abre_antes_min: number };
  const inicio = new Date(sessao.inicio);
  const { estado, abreEm } = estadoDaSala({
    inscricao: data.status,
    sessao: sessao.status,
    inicio,
    duracaoMin: agenda.duracao_min,
    abreAntesMin: agenda.abre_antes_min,
    agora: new Date(),
  });
  const { data: config } = await db.from("configuracao").select("nome, logo_url, cor_marca, whatsapp_suporte").eq("id", 1).maybeSingle();
  const marca = { nome: config?.nome ?? "Vórtex Call", logoUrl: (config?.logo_url as string | null) ?? null, cor: config?.cor_marca ?? "#0A8452" };
  if (estado === "cancelada" || estado === "acabou") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0b0d10] px-6 text-center text-white">
        <p className="text-lg font-medium">{estado === "cancelada" ? "Essa inscrição foi cancelada." : "Essa call já aconteceu."}</p>
        <a className="rounded-md bg-white px-4 py-2 font-medium text-black" href={`/agendar/${agenda.slug}`}>Escolher outro horário</a>
      </main>
    );
  }
  return (
    <Espera
      codigo={codigo}
      estadoInicial={estado}
      inicioIso={sessao.inicio}
      abreEmIso={abreEm.toISOString()}
      horaInicio={formatarHora(inicio, FUSO)}
      marca={marca}
      whatsappSuporte={(config?.whatsapp_suporte as string | null) ?? null}
    />
  );
}
