"use client";
// Gráficos do dashboard em SVG próprio (sem biblioteca). Escalas e geometria vêm de src/lib/regras/dashboard.ts;
// aqui só o desenho e a dica (tooltip) ao passar o mouse ou focar pelo teclado. O SVG escala pelo viewBox; no
// celular o gráfico rola na horizontal pra o texto do eixo não ficar minúsculo.
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { barrasAgrupadas, caminhoLinha, corDaNota, formatarDecimal, marcasEixo } from "@/src/lib/regras/dashboard";

const L = 640;
const A = 240;
const M = { t: 12, r: 12, b: 40, l: 40 };
const LP = L - M.l - M.r;
const AP = A - M.t - M.b;

const COR = {
  inscritos: "var(--color-marca-funil)",
  vieram: "var(--color-marca)",
  grade: "var(--color-linha)",
  eixo: "var(--color-texto-4)",
  erro: "var(--color-erro)",
  aviso: "#f59e0b",
  ok: "var(--color-marca)",
};

type Dica = { x: number; y: number; linhas: ReactNode[] };

function Moldura({ dica, rotulo, children }: { dica: Dica | null; rotulo: string; children: ReactNode }) {
  return (
    <div className="w-full overflow-x-auto">
      <div className="relative min-w-[520px]">
        <svg viewBox={`0 0 ${L} ${A}`} className="block w-full" role="group" aria-label={rotulo}>
          {children}
        </svg>
        {dica && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 w-max max-w-56 -translate-x-1/2 -translate-y-full rounded-md bg-texto px-3 py-1.5 text-xs leading-5 text-white shadow-md"
            style={{ left: `${(dica.x / L) * 100}%`, top: `calc(${(dica.y / A) * 100}% - 6px)` }}
          >
            {dica.linhas.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Grade horizontal + rótulos do eixo Y. */
function EixoY({ marcas, sufixo = "" }: { marcas: number[]; sufixo?: string }) {
  const topo = marcas[marcas.length - 1] || 1;
  return (
    <g aria-hidden>
      {marcas.map((m) => {
        const y = M.t + AP - (m / topo) * AP;
        return (
          <g key={m}>
            <line x1={M.l} x2={L - M.r} y1={y} y2={y} stroke={COR.grade} strokeDasharray={m === 0 ? undefined : "3 3"} />
            <text x={M.l - 6} y={y + 3.5} fontSize="11" textAnchor="end" fill={COR.eixo}>{m}{sufixo}</text>
          </g>
        );
      })}
    </g>
  );
}

/** Rótulo de sessão em duas linhas ("22/10" e "19:00") embaixo da barra. */
function RotuloX({ x, rotulo, mostrar }: { x: number; rotulo: string; mostrar: boolean }) {
  if (!mostrar) return null;
  const [d, h] = rotulo.split(" ");
  return (
    <text x={x} y={A - M.b + 15} fontSize="11" textAnchor="middle" fill={COR.eixo} aria-hidden>
      <tspan x={x}>{d}</tspan>
      {h && <tspan x={x} dy="13">{h}</tspan>}
    </text>
  );
}

const estiloFoco = "cursor-default outline-none [&:focus-visible>.alvo]:stroke-[var(--color-texto)] [&:focus-visible>.alvo]:stroke-2";

export type ItemInscritosVieram = { id: string; rotulo: string; inscritos: number; vieram: number };

/** Barras agrupadas por sessão: inscritos (verde claro) × vieram (verde). */
export function GraficoInscritosVieram({ itens }: { itens: ItemInscritosVieram[] }) {
  const [dica, setDica] = useState<Dica | null>(null);
  const marcas = marcasEixo(Math.max(0, ...itens.map((i) => Math.max(i.inscritos, i.vieram))));
  const topo = marcas[marcas.length - 1] || 1;
  const grupos = barrasAgrupadas({ grupos: itens.length, series: 2, largura: LP });
  const cada = Math.max(1, Math.ceil(itens.length / 8));
  const y = (v: number) => M.t + AP - (v / topo) * AP;
  return (
    <div>
      <Legenda itens={[{ cor: COR.inscritos, rotulo: "Inscritos" }, { cor: COR.vieram, rotulo: "Vieram" }]} />
      <Moldura dica={dica} rotulo="Inscritos e presentes por sessão">
        <EixoY marcas={marcas} />
        {itens.map((it, i) => {
          const g = grupos[i];
          const banda = LP / itens.length;
          const mostrar = () => setDica({ x: M.l + g.centro, y: y(Math.max(it.inscritos, it.vieram)), linhas: [<strong key="t">{it.rotulo}</strong>, `Inscritos: ${it.inscritos}`, `Vieram: ${it.vieram}`] });
          return (
            <g key={it.id} tabIndex={0} role="img" aria-label={`${it.rotulo}: ${it.inscritos} inscritos, ${it.vieram} vieram`} className={estiloFoco}
              onMouseEnter={mostrar} onMouseLeave={() => setDica(null)} onFocus={mostrar} onBlur={() => setDica(null)}>
              <rect className="alvo" x={M.l + i * banda} y={M.t} width={banda} height={AP} fill="transparent" />
              {[it.inscritos, it.vieram].map((v, s) => (
                <rect key={s} x={M.l + g.barras[s].x} y={y(v)} width={g.barras[s].largura} height={M.t + AP - y(v)} rx={2}
                  fill={s === 0 ? COR.inscritos : COR.vieram} />
              ))}
              <RotuloX x={M.l + g.centro} rotulo={it.rotulo} mostrar={i % cada === 0} />
            </g>
          );
        })}
      </Moldura>
    </div>
  );
}

export type ItemNota = { id: string; rotulo: string; nota: number; vieram: number };

/** Barras da nota média de interação por sessão (0 a 100), na cor da faixa, com a linha de corte "interagiu" (30). */
export function GraficoNotas({ itens }: { itens: ItemNota[] }) {
  const [dica, setDica] = useState<Dica | null>(null);
  const marcas = [0, 20, 40, 60, 80, 100];
  const grupos = barrasAgrupadas({ grupos: itens.length, series: 1, largura: LP, folga: 0.4 });
  const cada = Math.max(1, Math.ceil(itens.length / 8));
  const y = (v: number) => M.t + AP - (Math.min(100, Math.max(0, v)) / 100) * AP;
  return (
    <div>
      <Legenda itens={[{ cor: COR.erro, rotulo: "Abaixo de 30" }, { cor: COR.aviso, rotulo: "30 a 60" }, { cor: COR.ok, rotulo: "Acima de 60" }]} />
      <Moldura dica={dica} rotulo="Nota média de interação por sessão">
        <EixoY marcas={marcas} />
        <line x1={M.l} x2={L - M.r} y1={y(30)} y2={y(30)} stroke={COR.erro} strokeOpacity={0.5} strokeDasharray="5 4" aria-hidden />
        {itens.map((it, i) => {
          const g = grupos[i];
          const banda = LP / itens.length;
          const semPublico = it.vieram === 0;
          const texto = semPublico ? "Ninguém veio" : `Nota média: ${formatarDecimal(it.nota)}`;
          const mostrar = () => setDica({ x: M.l + g.centro, y: y(it.nota), linhas: [<strong key="t">{it.rotulo}</strong>, texto] });
          return (
            <g key={it.id} tabIndex={0} role="img" aria-label={`${it.rotulo}: ${texto}`} className={estiloFoco}
              onMouseEnter={mostrar} onMouseLeave={() => setDica(null)} onFocus={mostrar} onBlur={() => setDica(null)}>
              <rect className="alvo" x={M.l + i * banda} y={M.t} width={banda} height={AP} fill="transparent" />
              {!semPublico && (
                <rect x={M.l + g.barras[0].x} y={y(it.nota)} width={g.barras[0].largura} height={M.t + AP - y(it.nota)} rx={2} fill={COR[corDaNota(it.nota)]} />
              )}
              <RotuloX x={M.l + g.centro} rotulo={it.rotulo} mostrar={i % cada === 0} />
            </g>
          );
        })}
      </Moldura>
    </div>
  );
}

/** Linha de retenção: pessoas na sala a cada minuto, com a linha tracejada no fim previsto (duração da agenda).
 *  Teclado: foque o gráfico e use ← → (Home/End) pra andar pelos minutos. */
export function GraficoRetencao({ pontos, duracao }: { pontos: { minuto: number; presentes: number }[]; duracao: number | null }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  if (pontos.length === 0) return null;
  const marcas = marcasEixo(Math.max(0, ...pontos.map((p) => p.presentes)));
  const topo = marcas[marcas.length - 1] || 1;
  const ultimo = Math.max(1, pontos[pontos.length - 1].minuto);
  const x = (m: number) => M.l + (m / ultimo) * LP;
  const y = (v: number) => M.t + AP - (v / topo) * AP;
  const xy = pontos.map((p) => ({ x: x(p.minuto), y: y(p.presentes) }));
  const linha = caminhoLinha(xy);
  const area = `${linha} L${x(ultimo)},${M.t + AP} L${M.l},${M.t + AP} Z`;
  const passoRotulo = ultimo <= 30 ? 5 : ultimo <= 90 ? 15 : 30;
  const rotulos = pontos.filter((p) => p.minuto % passoRotulo === 0);
  const pico = pontos.reduce((melhor, p, i) => (p.presentes > pontos[melhor].presentes ? i : melhor), 0);
  const p = ativo === null ? null : pontos[ativo];
  const dica: Dica | null = p ? { x: x(p.minuto), y: y(p.presentes), linhas: [<strong key="t">Minuto {p.minuto}</strong>, `${p.presentes} na sala`] } : null;
  const banda = LP / pontos.length;

  function teclado(e: KeyboardEvent) {
    const atual = ativo ?? pico;
    const novo = e.key === "ArrowRight" ? atual + 1 : e.key === "ArrowLeft" ? atual - 1 : e.key === "Home" ? 0 : e.key === "End" ? pontos.length - 1 : null;
    if (novo === null) return;
    e.preventDefault();
    setAtivo(Math.min(pontos.length - 1, Math.max(0, novo)));
  }

  return (
    <div>
      <Legenda itens={[{ cor: COR.vieram, rotulo: "Na sala" }, ...(duracao ? [{ cor: COR.eixo, rotulo: `Fim previsto (${duracao} min)`, tracejado: true }] : [])]} />
      <Moldura dica={dica} rotulo="Retenção por minuto">
        <EixoY marcas={marcas} />
        <path d={area} fill={COR.vieram} opacity={0.12} aria-hidden />
        <path d={linha} fill="none" stroke={COR.vieram} strokeWidth={2} strokeLinejoin="round" aria-hidden />
        {duracao !== null && duracao <= ultimo && (
          <line x1={x(duracao)} x2={x(duracao)} y1={M.t} y2={M.t + AP} stroke={COR.eixo} strokeDasharray="5 4" aria-hidden />
        )}
        {rotulos.map((r) => (
          <text key={r.minuto} x={x(r.minuto)} y={A - M.b + 16} fontSize="11" textAnchor={r.minuto === ultimo ? "end" : "middle"} fill={COR.eixo} aria-hidden>{r.minuto} min</text>
        ))}
        {p && (
          <g aria-hidden>
            <line x1={x(p.minuto)} x2={x(p.minuto)} y1={M.t} y2={M.t + AP} stroke={COR.vieram} strokeOpacity={0.4} />
            <circle cx={x(p.minuto)} cy={y(p.presentes)} r={4} fill={COR.vieram} stroke="white" strokeWidth={2} />
          </g>
        )}
        <g tabIndex={0} role="img" className="outline-none focus-visible:[&>rect.moldura]:stroke-[var(--color-marca)]"
          aria-label={`Retenção: pico de ${pontos[pico].presentes} pessoas no minuto ${pontos[pico].minuto}. Use as setas pra ver cada minuto.`}
          onKeyDown={teclado} onFocus={() => setAtivo((a) => a ?? pico)} onBlur={() => setAtivo(null)} onMouseLeave={() => setAtivo(null)}>
          <rect className="moldura" x={M.l} y={M.t} width={LP} height={AP} fill="transparent" strokeWidth={1.5} rx={2} />
          {pontos.map((pt, i) => (
            <rect key={pt.minuto} x={x(pt.minuto) - banda / 2} y={M.t} width={banda} height={AP} fill="transparent" onMouseEnter={() => setAtivo(i)} />
          ))}
        </g>
      </Moldura>
    </div>
  );
}

function Legenda({ itens }: { itens: { cor: string; rotulo: string; tracejado?: boolean }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-3">
      {itens.map((i) => (
        <li key={i.rotulo} className="inline-flex items-center gap-1.5">
          {i.tracejado ? (
            <span className="inline-block h-3 w-0 border-l-2 border-dashed" style={{ borderColor: i.cor }} aria-hidden />
          ) : (
            <span className="inline-block size-2.5 rounded-sm" style={{ background: i.cor }} aria-hidden />
          )}
          {i.rotulo}
        </li>
      ))}
    </ul>
  );
}
