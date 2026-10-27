import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { carregarAgendaPublica } from "@/src/lib/agendamento";
import { lerPrefill } from "@/src/lib/regras/encaixe";
import { Modulo } from "./modulo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agende sua call", robots: { index: false, follow: false } };

export default async function Agendar({ params, searchParams }: {
  params: Promise<{ agenda: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agenda } = await params;
  let dados: Awaited<ReturnType<typeof carregarAgendaPublica>>;
  try {
    dados = await carregarAgendaPublica(agenda);
  } catch {
    return (
      <main className="flex min-h-screen items-start justify-center bg-fundo px-4 py-10">
        <p className="text-texto-3">Não deu para carregar os horários. Tente de novo em instantes.</p>
      </main>
    );
  }
  if (!dados) notFound();
  const prefill = lerPrefill(await searchParams);
  return (
    <main className={prefill.embed ? "p-0" : "flex min-h-screen items-start justify-center bg-fundo px-4 py-10"}>
      <Modulo agenda={dados.agenda} sessoes={dados.sessoes} prefill={prefill} />
    </main>
  );
}
