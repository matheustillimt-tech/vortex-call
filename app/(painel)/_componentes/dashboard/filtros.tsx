"use client";
// Barra de filtros do dashboard (Início). Tudo mora na query string: trocar um filtro faz `router.replace` e a
// página (server component) lê de novo. Trocar período ou agenda limpa a sessão escolhida (ela pode sair da lista).
import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { PERIODOS_DASHBOARD, ROTULO_PERIODO, queryDosFiltros, type FiltrosDashboard, type PeriodoDashboard } from "@/src/lib/regras/dashboard";
import { estiloInput, estiloSegmento, estiloSelect } from "../ui";

export function FiltrosDashboardBarra({ filtros, agendas, sessoes, diasAtuais, vendedores }: {
  filtros: FiltrosDashboard;
  agendas: { id: string; nome: string }[];
  /** Só o admin recebe (o membro já vê só o que é dele). */
  vendedores?: { id: string; nome: string }[];
  sessoes: { id: string; rotulo: string }[];
  /** Dias do período em uso (pra preencher o personalizado quando ele é escolhido). */
  diasAtuais: { de: string; ate: string };
}) {
  const router = useRouter();
  const caminho = usePathname();
  const [carregando, iniciar] = useTransition();

  function ir(novo: FiltrosDashboard) {
    iniciar(() => router.replace(`${caminho}${queryDosFiltros(novo)}`, { scroll: false }));
  }

  function periodo(p: PeriodoDashboard) {
    if (p === "personalizado") ir({ ...filtros, periodo: p, de: filtros.de ?? diasAtuais.de, ate: filtros.ate ?? diasAtuais.ate, sessao: null });
    else ir({ ...filtros, periodo: p, de: null, ate: null, sessao: null });
  }

  return (
    <div className="flex flex-wrap items-end gap-3" aria-busy={carregando || undefined}>
      <div role="group" aria-label="Período" className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-md bg-suave p-1 text-texto-3">
        {PERIODOS_DASHBOARD.map((p) => (
          <button key={p} type="button" aria-pressed={p === filtros.periodo} onClick={() => periodo(p)} className={estiloSegmento(p === filtros.periodo)}>
            {ROTULO_PERIODO[p]}
          </button>
        ))}
      </div>
      {filtros.periodo === "personalizado" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-texto-3">
            De
            <input type="date" className={`${estiloInput} w-40`} value={filtros.de ?? ""} max={filtros.ate ?? undefined}
              onChange={(e) => e.target.value && ir({ ...filtros, de: e.target.value, sessao: null })} />
          </label>
          <label className="grid gap-1 text-xs text-texto-3">
            Até
            <input type="date" className={`${estiloInput} w-40`} value={filtros.ate ?? ""} min={filtros.de ?? undefined}
              onChange={(e) => ir({ ...filtros, ate: e.target.value || null, sessao: null })} />
          </label>
        </div>
      )}
      <label className="grid min-w-44 flex-1 gap-1 text-xs text-texto-3 sm:flex-none">
        Agenda
        <select className={estiloSelect} value={filtros.agenda ?? ""} onChange={(e) => ir({ ...filtros, agenda: e.target.value || null, sessao: null })}>
          <option value="">Todas as agendas</option>
          {agendas.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
        </select>
      </label>
      {vendedores && (
        <label className="grid min-w-44 flex-1 gap-1 text-xs text-texto-3 sm:flex-none">
          Vendedor
          <select className={estiloSelect} value={filtros.vendedor ?? ""} onChange={(e) => ir({ ...filtros, vendedor: e.target.value || null, sessao: null })}>
            <option value="">Todos os vendedores</option>
            {filtros.vendedor && !vendedores.some((v) => v.id === filtros.vendedor) && <option value={filtros.vendedor}>Vendedor escolhido</option>}
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
          </select>
        </label>
      )}
      <label className="grid min-w-52 flex-1 gap-1 text-xs text-texto-3 sm:flex-none">
        Sessão
        <select className={estiloSelect} value={filtros.sessao ?? ""} onChange={(e) => ir({ ...filtros, sessao: e.target.value || null })}>
          <option value="">Todas as sessões</option>
          {filtros.sessao && !sessoes.some((s) => s.id === filtros.sessao) && <option value={filtros.sessao}>Sessão escolhida</option>}
          {sessoes.map((s) => <option key={s.id} value={s.id}>{s.rotulo}</option>)}
        </select>
      </label>
      {carregando && <LoaderCircle className="mb-2 size-4 animate-spin text-texto-3" aria-label="Atualizando" />}
    </div>
  );
}
