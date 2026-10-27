// Cartões do dashboard (server component): funil, indicadores e o gráfico de funil em barras horizontais.
// Usados no Início (período inteiro) e no painel da sessão (uma sessão só). `verReceita` = permissão `receita`: sem
// ela, somem a etapa "Compraram", a Receita e a Conversão (o banco já devolve esses números nulos).
import { Banknote, Clock, MessageCircle, Percent, ShoppingCart, UserCheck, Users, type LucideIcon } from "lucide-react";
import type { Resumo } from "@/src/lib/dashboard";
import { etapasFunil, formatarMinutosMedios, formatarPercentual, formatarReais } from "@/src/lib/regras/dashboard";
import { Cartao, Numero } from "../ui";

const ICONE_ETAPA: Record<string, LucideIcon> = {
  inscritos: Users,
  vieram: UserCheck,
  interagiram: MessageCircle,
  compraram: ShoppingCart,
};

const AJUDA_ETAPA: Record<string, string> = {
  inscritos: "Inscrições não canceladas nas sessões do filtro.",
  vieram: "Marcados como presentes ou que entraram na sala.",
  interagiram: "Nota de interação 30 ou mais.",
  compraram: "Compra aprovada (webhook de vendas) ligada à inscrição.",
};

/** Fileira de `n` cartões (2 a 4): lado a lado em tela larga; 4 viram 2 + 2 em tela média; no celular 2 por linha
 *  (com número ímpar, o último ocupa a linha inteira) ou 1 por linha (`umPorLinha`, pra valores largos como a receita). */
function classeFileira(n: number, umPorLinha = false) {
  const celular = umPorLinha ? "grid-cols-1" : n % 2 ? "grid-cols-2 [&>*:last-child]:col-span-2" : "grid-cols-2";
  const largo = n >= 4 ? "md:grid-cols-2 xl:grid-cols-4" : n === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  return `grid gap-4 ${celular} md:[&>*]:col-span-1 ${largo}`;
}

/** Os cartões do funil: Vieram com o % dos inscritos, as etapas depois com o % de quem veio. */
function etapas(resumo: Resumo, verReceita: boolean) {
  const todas = etapasFunil(resumo);
  return verReceita ? todas : todas.filter((e) => e.chave !== "compraram");
}

export function CartoesFunil({ resumo, verReceita = true }: { resumo: Resumo; verReceita?: boolean }) {
  const lista = etapas(resumo, verReceita);
  return (
    <div className={classeFileira(lista.length)}>
      {lista.map((e) => (
        <Numero
          key={e.chave}
          rotulo={e.rotulo}
          valor={e.valor}
          icone={ICONE_ETAPA[e.chave]}
          ajuda={AJUDA_ETAPA[e.chave]}
          variacao={e.percentual === null ? "Início do funil" : `${e.percentual} ${e.sobre}`}
        />
      ))}
    </div>
  );
}

/** Receita, conversão, comparecimento e tempo médio (a nota média saiu dos cartões em 26/10/2026). */
export function Indicadores({ resumo, verReceita = true }: { resumo: Resumo; verReceita?: boolean }) {
  return (
    <div className={classeFileira(verReceita ? 4 : 2, true)}>
      {verReceita && (
        <>
          <Numero rotulo="Receita" valor={formatarReais(resumo.receita_centavos)} icone={Banknote} ajuda="Soma das compras aprovadas ligadas às inscrições." />
          <Numero rotulo="Conversão" valor={formatarPercentual(resumo.compraram, resumo.vieram)} icone={Percent} ajuda="Compraram ÷ vieram." variacao={`${resumo.compraram} de ${resumo.vieram} que vieram`} />
        </>
      )}
      <Numero rotulo="Comparecimento" valor={formatarPercentual(resumo.vieram, resumo.inscritos)} icone={UserCheck} ajuda="Vieram ÷ inscritos." variacao={`${resumo.vieram} de ${resumo.inscritos} inscritos`} />
      <Numero rotulo="Tempo médio" valor={formatarMinutosMedios(resumo.minutos_medios)} icone={Clock} ajuda="Média de minutos na sala de quem veio." />
    </div>
  );
}

/** Funil em barras horizontais centradas, largura proporcional aos inscritos; o % segue `etapasFunil`. */
export function GraficoFunil({ resumo, verReceita = true }: { resumo: Resumo; verReceita?: boolean }) {
  const lista = etapas(resumo, verReceita);
  const base = Math.max(1, lista[0].valor);
  return (
    <Cartao titulo="Funil" icone={Users}>
      <ol className="grid gap-2" aria-label="Funil">
        {lista.map((e) => {
          const largura = Math.min(100, Math.max(e.valor > 0 ? 4 : 0, (e.valor / base) * 100));
          return (
            <li key={e.chave} className="grid grid-cols-[minmax(7rem,9rem)_1fr_auto] items-center gap-3 text-sm max-pn-sm:grid-cols-[6.5rem_1fr_auto]">
              <span className="truncate text-texto-2">{e.rotulo}</span>
              <span className="flex h-7 justify-center rounded-sm bg-suave">
                <span className="h-full rounded-sm bg-marca transition-[width]" style={{ width: `${largura}%`, opacity: 1 - lista.indexOf(e) * 0.13 }} />
              </span>
              <span className="w-24 text-right tabular-nums text-texto">
                {e.valor}
                {e.percentual !== null && (
                  <span className="ml-1 text-xs text-texto-3" title={`${e.percentual} ${e.sobre}`}>
                    ({e.percentual})
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-texto-3">% de Vieram sobre os inscritos; as etapas seguintes, sobre quem veio.</p>
    </Cartao>
  );
}
