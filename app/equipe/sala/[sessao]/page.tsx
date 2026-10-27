import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { podeVerSessao } from "@/src/lib/acesso";
import { pode, SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { dbUsuario, exigirMembro } from "@/src/lib/supabase/usuario";
import { Cliente } from "./cliente";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sala", robots: { index: false, follow: false } };

/** Entrada da equipe na sala (fora do layout do painel: tela cheia, sem menu). `?modo=espiao` entra como ouvinte
 *  invisível; qualquer outro valor (ou nenhum) entra como anfitrião. */
export default async function SalaEquipe({ params, searchParams }: {
  params: Promise<{ sessao: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sessao } = await params;
  // Admin em qualquer sessão; membro só nas das agendas dele (senão 404). `todas_agendas` não abre a sala (só leitura).
  const eu = await exigirMembro();
  if (!(await podeVerSessao(eu, sessao))) notFound();
  const sp = await searchParams;
  const modo: "anfitriao" | "espiao" = sp.modo === "espiao" ? "espiao" : "anfitriao";
  // Sem a permissão do modo: aviso (a rota que dá o passe também recusa, com 403).
  if (!pode(eu, modo)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-fundo p-6 text-center text-sm text-texto-2">
        <p>{SEM_PERMISSAO}</p>
        <Link href={`/sessoes/${sessao}`} className="font-medium text-marca hover:underline">Voltar pra sessão</Link>
      </main>
    );
  }
  const db = await dbUsuario();
  const { data: s } = await db.from("sessoes").select("id, agendas(nome, roteiro)").eq("id", sessao).maybeSingle();
  if (!s) notFound();
  // O roteiro só chega na sala da equipe (o convidado em /c/{codigo} nunca recebe).
  const agenda = (Array.isArray(s.agendas) ? s.agendas[0] : s.agendas) as { nome?: string; roteiro?: string } | null | undefined;
  const roteiro = agenda?.roteiro ?? "";
  const { data: config } = await db.from("configuracao").select("nome, logo_url, cor_marca").eq("id", 1).maybeSingle();
  const marca = {
    nome: config?.nome ?? "Vórtex Call",
    logoUrl: (config?.logo_url as string | null) ?? null,
    cor: config?.cor_marca ?? "#0A8452",
  };
  return <Cliente sessaoId={sessao} modo={modo} marca={marca} roteiro={roteiro} titulo={agenda?.nome} verFicha={pode(eu, "ficha")} verTranscricao={pode(eu, "transcricao")} />;
}
