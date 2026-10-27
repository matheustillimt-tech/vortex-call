// Primitivos do painel (estilo shadcn/ui, paleta zinc, tema claro).
// Este arquivo não tem "use client": tudo aqui roda em server component.
// Os interativos ficam em arquivos próprios: modal.tsx (Modal), toast.tsx (ProvedorToast, useToast, confirmar),
// paginacao.tsx (Paginacao), stepper.tsx (Stepper, RodapeAssistente).
import Link from "next/link";
import { Info, LoaderCircle } from "lucide-react";
import { Icone, type LucideIcon } from "./icone";
import { Logo, Simbolo } from "./logo";

export type Tom = "ok" | "atencao" | "erro" | "neutro";
export type CorSelo = "ok" | "erro" | "neutro" | "aviso" | "destaque";
export type Trilha = { rotulo: string; href?: string }[];
/** Ícone de cartão/número: componente lucide ou nome antigo do Material (ver `icone.tsx`). */
export type IconeEntrada = LucideIcon | string;

function iconeDe(icone: IconeEntrada, tamanho: number, className = "") {
  return typeof icone === "string" ? <Icone nome={icone} tamanho={tamanho} className={className} /> : <Icone icone={icone} tamanho={tamanho} className={className} />;
}

/* ------------------------------------------------------------------ superfícies */

/** Cartão: branco, borda slate-300, raio 8, sem sombra. */
export const estiloCartao = "rounded-lg border border-borda bg-superficie";
/** Caixa informativa na cor de marca clara. */
export const estiloCartaoDestaque = "rounded-lg border border-marca-funil bg-marca-linha text-texto-2";

/** Ações em texto dentro de listas e tabelas (ver, cancelar, marcar como visto…). */
export const estiloAcao = {
  normal: "inline-flex items-center gap-1 text-sm font-medium text-marca transition-colors hover:text-marca-escura hover:underline",
  perigo: "inline-flex items-center gap-1 text-sm font-medium text-erro transition-colors hover:text-erro-hover hover:underline",
  neutro: "inline-flex items-center gap-1 text-sm text-texto-3 transition-colors hover:text-texto",
} as const;

/** Logo do produto. `comNome={false}` = só o símbolo (menu recolhido). */
export function Marca({ comNome = true, altura = 28 }: { comNome?: boolean; altura?: number }) {
  return comNome ? <Logo altura={altura} /> : <Simbolo tamanho={32} />;
}

export function Migalha({ trilha }: { trilha: Trilha }) {
  return (
    <nav aria-label="Caminho" className="mb-1 text-sm text-texto-3">
      {trilha.map((t, i) => (
        <span key={`${t.rotulo}-${i}`}>
          {t.href ? <Link href={t.href} className="transition-colors hover:text-texto">{t.rotulo}</Link> : t.rotulo}
          <span className="mx-1.5 text-apagado">›</span>
        </span>
      ))}
    </nav>
  );
}

/** Tooltip de ajuda: ícone "i" cinza que mostra o texto ao passar o mouse ou focar (teclado). Fechado, fica com
 *  `display:none`: invisível mas no layout, ele empurrava a página para o lado nos cartões da direita. */
export function AjudaInfo({ texto, lado = "cima" }: { texto: React.ReactNode; lado?: "cima" | "baixo" }) {
  return (
    <span className="group/ajuda relative inline-flex align-middle">
      <button type="button" aria-label="Ajuda" className="inline-grid size-5 place-items-center rounded-full text-apagado transition-colors hover:text-texto-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40">
        <Info size={16} aria-hidden />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-40 hidden w-max max-w-[min(260px,calc(100vw-2rem))] -translate-x-1/2 rounded-md bg-texto px-3 py-1.5 text-xs font-normal leading-4 text-white shadow-md group-hover/ajuda:block group-focus-within/ajuda:block ${lado === "cima" ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
      >
        {texto}
      </span>
    </span>
  );
}

/** Título de página: `h1` de 30/700 à esquerda, ações à direita na mesma linha.
 *  `subtitulo` continua aceito (14 px cinza), mas o padrão é não ter. */
export function Pagina({ titulo, sobretitulo, subtitulo, trilha, acoes, infoTitulo, contador, children }: {
  /** Sem `titulo`, não desenha o `<h1>` (telas com o título em outro lugar, ex.: assistente com stepper). */
  titulo?: string;
  sobretitulo?: string;
  subtitulo?: React.ReactNode;
  trilha?: Trilha;
  acoes?: React.ReactNode;
  /** Slot ao lado do título (ex.: `<AjudaInfo texto="…" />`). */
  infoTitulo?: React.ReactNode;
  /** Contador ao lado do título. */
  contador?: React.ReactNode;
  children: React.ReactNode;
}) {
  const temCabecalho = titulo || sobretitulo || subtitulo || trilha || acoes;
  return (
    <div className="space-y-6">
      {temCabecalho && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            {trilha && <Migalha trilha={trilha} />}
            {sobretitulo && <p className="mb-0.5 text-sm text-texto-3">{sobretitulo}</p>}
            {titulo && (
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="min-w-0 break-words text-pagina text-titulo">{titulo}</h1>
                {infoTitulo}
                {contador}
              </div>
            )}
            {subtitulo && <p className="mt-1 text-sm text-texto-3">{subtitulo}</p>}
          </div>
          {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/** Cabeçalho de cartão: quadradinho 24×24 (marca clara + ícone na cor de marca), título 14 px e "i". */
function CabecalhoCartao({ titulo, icone, ajuda, acao }: { titulo?: string; icone?: IconeEntrada; ajuda?: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {icone && <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-marca-clara p-1 text-marca-forte">{iconeDe(icone, 16)}</span>}
        {titulo && <h2 className="min-w-0 truncate text-sm font-semibold text-texto-2">{titulo}</h2>}
        {ajuda && <AjudaInfo texto={ajuda} />}
      </div>
      {acao}
    </div>
  );
}

export function Cartao({ titulo, icone, ajuda, acao, destaque = false, className = "", children }: {
  titulo?: string;
  /** Quadradinho de ícone antes do título (lucide ou nome antigo). */
  icone?: IconeEntrada;
  /** Texto do "i" ao lado do título. */
  ajuda?: React.ReactNode;
  acao?: React.ReactNode;
  destaque?: boolean;
  /** Padding padrão 24 px; passe `p-8` (assistente) ou `p-4` no `className` pra trocar. */
  className?: string;
  children: React.ReactNode;
}) {
  const temPadding = /(^|\s)p-\S+/.test(className);
  return (
    <section className={`${destaque ? estiloCartaoDestaque : estiloCartao} ${temPadding ? "" : "p-6 max-pn-sm:p-4"} ${className}`}>
      {(titulo || acao || icone) && <CabecalhoCartao titulo={titulo} icone={icone} ajuda={ajuda} acao={acao} />}
      {children}
    </section>
  );
}

const TOM_TEXTO: Record<Tom, string> = { ok: "text-ok", atencao: "text-aviso", erro: "text-erro", neutro: "text-texto-3" };

/** Cartão de número do Dashboard: cabeçalho com ícone + rótulo 14/500 + "i", valor 24/700. */
export function Numero({ rotulo, valor, sufixo, variacao, tom = "neutro", icone, ajuda, nota }: {
  rotulo: string;
  valor: string | number;
  sufixo?: string;
  variacao?: string;
  tom?: Tom;
  /** @deprecated o painel não destaca cartão de número; a prop fica só pra não quebrar quem passa. */
  destaque?: boolean;
  icone?: IconeEntrada;
  ajuda?: React.ReactNode;
  /** Nota de 10 px embaixo (ex.: "Conecte um checkout em Configurações…"). */
  nota?: React.ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-3 rounded-lg border border-borda bg-superficie p-6 max-pn-sm:p-4`}>
      <div className="flex min-w-0 items-center gap-2">
        {icone && <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-marca-clara p-1 text-marca-forte">{iconeDe(icone, 16)}</span>}
        <p className="min-w-0 truncate text-sm font-medium text-texto-2">{rotulo}</p>
        {ajuda && <AjudaInfo texto={ajuda} />}
      </div>
      <div className="min-w-0">
        <p className="truncate text-valor font-bold tabular-nums text-texto">
          {valor}
          {sufixo && <span className="text-sm font-normal text-texto-3"> {sufixo}</span>}
        </p>
        {variacao && <p className={`text-xs ${TOM_TEXTO[tom]}`}>{variacao}</p>}
        {nota && <p className="mt-1 text-nota text-texto-4">{nota}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ botões */

/** principal = sólido #14532D ("Criar novo"); contorno = borda #14532D / 700 ("Continuar"); secundario = branco com
 *  borda slate-300 e sombra; perigo = vermelho sólido; fantasma = sem borda, hover cinza (ações discretas). */
export type VarianteBotao = "principal" | "contorno" | "secundario" | "perigo" | "fantasma";
export type TamanhoBotao = "padrao" | "pequeno";

const BASE_BOTAO =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const TAMANHO_BOTAO: Record<TamanhoBotao, string> = {
  padrao: "h-9 px-4",
  pequeno: "h-8 px-3 text-xs",
};

const COR_BOTAO: Record<VarianteBotao, string> = {
  principal: "bg-principal font-medium text-white hover:bg-principal-hover",
  contorno: "border border-principal bg-superficie font-bold text-principal hover:bg-principal/5",
  secundario: "border border-borda bg-superficie font-medium text-texto shadow-controle hover:bg-suave",
  perigo: "bg-erro font-medium text-white hover:bg-erro-hover",
  fantasma: "font-medium text-texto-2 hover:bg-suave hover:text-texto",
};

export function estiloBotao(variante: VarianteBotao = "principal", tamanho: TamanhoBotao = "padrao"): string {
  return `${BASE_BOTAO} ${TAMANHO_BOTAO[tamanho]} ${COR_BOTAO[variante]}`;
}

export function Botao({ children, variante = "principal", tamanho = "padrao", icone, carregando = false, className, disabled, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBotao;
  tamanho?: TamanhoBotao;
  icone?: React.ReactNode;
  /** Mostra o giro e desativa o botão. */
  carregando?: boolean;
}) {
  return (
    <button {...p} disabled={disabled || carregando} aria-busy={carregando || undefined} className={`${estiloBotao(variante, tamanho)} ${className ?? ""}`}>
      {carregando ? <LoaderCircle className="animate-spin" aria-hidden /> : icone}
      {children}
    </button>
  );
}

export function BotaoLink({ href, children, variante = "principal", tamanho = "padrao", icone, className, ...p }: {
  href: string;
  children: React.ReactNode;
  variante?: VarianteBotao;
  tamanho?: TamanhoBotao;
  icone?: React.ReactNode;
  className?: string;
  target?: string;
  rel?: string;
}) {
  return (
    <Link href={href} {...p} className={`${estiloBotao(variante, tamanho)} ${className ?? ""}`}>
      {icone}
      {children}
    </Link>
  );
}

/** Botão só de ícone. `tabela` = 50×40 (ações das tabelas, ícone na cor de marca); `redondo` = 36 px
 *  pílula; `quadrado` = 36×36. `rotulo` vira `aria-label` e `title`. */
export function estiloBotaoIcone(formato: "tabela" | "redondo" | "quadrado" = "quadrado", cor: "marca" | "neutro" | "perigo" = "neutro"): string {
  const tamanho = formato === "tabela" ? "h-10 w-[50px] rounded-md" : formato === "redondo" ? "size-9 rounded-full" : "size-9 rounded-md";
  const tom = cor === "marca" ? "text-marca hover:bg-marca-linha" : cor === "perigo" ? "text-erro hover:bg-erro-fundo" : "text-texto-3 hover:bg-suave hover:text-texto";
  return `inline-grid shrink-0 place-items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40 disabled:pointer-events-none disabled:opacity-50 ${tamanho} ${tom}`;
}

export function BotaoIcone({ rotulo, icone, formato = "quadrado", cor = "neutro", tamanhoIcone = 20, className, type = "button", ...p }: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  rotulo: string;
  icone: IconeEntrada;
  formato?: "tabela" | "redondo" | "quadrado";
  cor?: "marca" | "neutro" | "perigo";
  tamanhoIcone?: number;
}) {
  return (
    <button type={type} aria-label={rotulo} title={rotulo} {...p} className={`${estiloBotaoIcone(formato, cor)} ${className ?? ""}`}>
      {iconeDe(icone, tamanhoIcone)}
    </button>
  );
}

/* ------------------------------------------------------------------ campos */

export const estiloInput =
  "w-full min-w-0 rounded-md border border-borda bg-superficie px-3 py-[7px] text-sm text-texto shadow-controle outline-none transition-[color,box-shadow,border-color] placeholder:text-apagado focus:border-marca focus:ring-2 focus:ring-marca/20 disabled:cursor-not-allowed disabled:bg-suave disabled:opacity-70 aria-[invalid=true]:border-erro file:mr-3 file:rounded file:border-0 file:bg-suave file:px-2 file:py-0.5 file:text-sm file:font-medium file:text-texto";

/** Select nativo com seta (chevron cinza à direita). */
export const estiloSelect = `${estiloInput} appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")] bg-[length:16px] bg-[position:right_10px_center] bg-no-repeat pr-9`;

export const estiloTextarea = `${estiloInput} min-h-20 py-2 leading-5`;

/** Label 14/500 slate-900 em cima, campo, e embaixo a ajuda (12 px cinza) ou o erro; `contador` ("34 de 150")
 *  à direita. `info` põe o "i" ao lado do rótulo. */
export function Campo({ rotulo, dica, erro, contador, info, obrigatorio = false, className = "", children }: {
  rotulo: React.ReactNode;
  dica?: React.ReactNode;
  erro?: React.ReactNode;
  contador?: string;
  info?: React.ReactNode;
  obrigatorio?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block space-y-2 ${className}`}>
      <span className="flex items-center gap-1.5 text-sm font-medium leading-none text-rotulo">
        {rotulo}
        {obrigatorio && <span className="text-erro">*</span>}
        {info && <AjudaInfo texto={info} />}
      </span>
      {children}
      {(dica || erro || contador) && (
        <span className="flex items-start justify-between gap-2">
          {erro ? <span className="flex-1 text-xs text-erro">{erro}</span> : dica ? <span className="flex-1 text-xs text-texto-3">{dica}</span> : <span className="flex-1" />}
          {contador && <span className="shrink-0 text-xs tabular-nums text-texto-4">{contador}</span>}
        </span>
      )}
    </label>
  );
}

type PropsCampoBase = { rotulo: React.ReactNode; dica?: React.ReactNode; erro?: React.ReactNode; contador?: string; info?: React.ReactNode; classeCampo?: string };

/** `<input>` com label e ajuda. Demais props vão pro input. */
export function CampoTexto({ rotulo, dica, erro, contador, info, classeCampo, className, ...p }: PropsCampoBase & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Campo rotulo={rotulo} dica={dica} erro={erro} contador={contador} info={info} obrigatorio={p.required} className={classeCampo}>
      <input {...p} aria-invalid={erro ? true : p["aria-invalid"]} className={`${estiloInput} ${className ?? ""}`} />
    </Campo>
  );
}

/** `<select>` com label e ajuda. Passe as `<option>` como filhos. */
export function CampoSelecao({ rotulo, dica, erro, contador, info, classeCampo, className, children, ...p }: PropsCampoBase & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Campo rotulo={rotulo} dica={dica} erro={erro} contador={contador} info={info} obrigatorio={p.required} className={classeCampo}>
      <select {...p} aria-invalid={erro ? true : p["aria-invalid"]} className={`${estiloSelect} ${className ?? ""}`}>
        {children}
      </select>
    </Campo>
  );
}

/** `<textarea>` com label e ajuda. */
export function CampoAreaTexto({ rotulo, dica, erro, contador, info, classeCampo, className, ...p }: PropsCampoBase & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Campo rotulo={rotulo} dica={dica} erro={erro} contador={contador} info={info} obrigatorio={p.required} className={classeCampo}>
      <textarea {...p} aria-invalid={erro ? true : p["aria-invalid"]} className={`${estiloTextarea} ${className ?? ""}`} />
    </Campo>
  );
}

/* ------------------------------------------------------------------ selo (badge) */

/** Badge sólido: h 24, raio 12, 12/500. `destaque` = cor de marca sólida. */
const COR_SELO: Record<CorSelo, string> = {
  destaque: "bg-marca text-white",
  ok: "bg-ok-fundo text-[#166534]",
  erro: "bg-erro-fundo text-[#991b1b]",
  aviso: "bg-aviso-fundo text-[#92400e]",
  neutro: "bg-suave text-texto-2",
};

/** Cor da bolinha de status (fora do selo: online, lido etc.). */
export const PONTO: Record<CorSelo, string> = { ok: "bg-ok", erro: "bg-erro", neutro: "bg-apagado", aviso: "bg-aviso", destaque: "bg-marca" };

export function Selo({ cor, children }: {
  cor: CorSelo;
  /** @deprecated O selo não tem bolinha; a prop fica só pra não quebrar quem passa. */
  semPonto?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`inline-flex h-6 max-w-full shrink-0 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap ${COR_SELO[cor]}`}>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ tabela */

/** Célula padrão (8 px) e cabeçalho (h 40, 14/500 zinc-500), pra quem monta `<td>`/`<th>` à mão. */
export const estiloCelula = "px-2 py-2 align-middle";
export const estiloCabecalhoTabela = "h-10 px-2 text-left align-middle text-sm font-medium whitespace-nowrap text-texto-4";
/** Linha clicável com hover na cor de marca clara (listas do painel). */
export const estiloLinhaMarca = "transition-colors hover:bg-marca-linha";

/** Tabela (estilo shadcn/ui): cabeçalho 14/500 cinza, linhas com borda zinc-200 e hover cinza, rolagem horizontal
 *  no celular (não vira cartão). `rodape` recebe a `<Paginacao>`. Sem dados, mostra `vazio` numa linha de 96 px. */
export function Tabela({ colunas, children, vazio, vazioDetalhe, semCabecalhoQuandoVazio = false, semCabecalho = false, rodape, semBorda = false, className = "" }: {
  colunas: React.ReactNode[];
  children?: React.ReactNode;
  vazio?: string;
  vazioDetalhe?: string;
  semCabecalhoQuandoVazio?: boolean;
  /** @deprecated o vazio da tabela não tem mais ícone. */
  vazioSemIcone?: boolean;
  semCabecalho?: boolean;
  rodape?: React.ReactNode;
  /** Sem a moldura (quando a tabela já está dentro de um `Cartao`). */
  semBorda?: boolean;
  className?: string;
}) {
  const oculta = semCabecalho || (semCabecalhoQuandoVazio && !!vazio);
  return (
    <div className={`${semBorda ? "" : "rounded-lg border border-borda bg-superficie"} ${className}`}>
      <div className="w-full overflow-x-auto">
        <table className="w-full caption-bottom text-sm">
          {!oculta && (
            <thead className="[&_tr]:border-b [&_tr]:border-linha">
              <tr>{colunas.map((c, i) => <th key={i} className={`${estiloCabecalhoTabela} first:pl-4 last:pr-4`}>{c}</th>)}</tr>
            </thead>
          )}
          <tbody className="[&>tr]:border-b [&>tr]:border-linha [&>tr:last-child]:border-0 [&>tr]:transition-colors [&>tr:hover]:bg-suave/50 [&>tr>td:first-child]:pl-4 [&>tr>td:last-child]:pr-4">
            {children}
          </tbody>
        </table>
      </div>
      {vazio && (
        <div className="flex min-h-24 flex-col items-center justify-center gap-1 px-4 py-6 text-center">
          <p className="text-sm text-texto">{vazio}</p>
          {vazioDetalhe && <p className="max-w-sm text-sm text-texto-3">{vazioDetalhe}</p>}
        </div>
      )}
      {rodape && <div className="border-t border-linha px-4 py-3">{rodape}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ estado vazio */

/** Estado vazio: frase + detalhe e ação opcionais. O padrão é só o texto ("Sem resultados.");
 *  `icone` (ou `comIcone`) põe um círculo cinza com ícone em cima, pra telas inteiras vazias. */
export function Vazio({ texto = "Sem resultados.", icone, comIcone = false, acao, compacto = false, detalhe }: {
  texto?: string;
  icone?: React.ReactNode;
  comIcone?: boolean;
  acao?: React.ReactNode;
  compacto?: boolean;
  detalhe?: React.ReactNode;
  /** @deprecated sem ícone já é o padrão. */
  semIcone?: boolean;
}) {
  const mostraIcone = !!icone || comIcone;
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-center ${compacto ? "min-h-24 px-4 py-6" : "px-6 py-12"}`}>
      {mostraIcone && <span className="grid size-10 place-items-center rounded-full bg-suave text-texto-4">{icone ?? <Icone nome="inbox" tamanho={20} />}</span>}
      <p className="text-sm font-medium text-texto">{texto}</p>
      {detalhe && <p className="max-w-sm text-sm text-texto-3">{detalhe}</p>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}

/** Outro nome do mesmo componente. */
export const EstadoVazio = Vazio;

/* ------------------------------------------------------------------ segmentos */

export const estiloSegmentos = "inline-flex h-9 max-w-full items-center overflow-x-auto rounded-md bg-suave p-1 text-texto-3";
export function estiloSegmento(ativo: boolean): string {
  return `inline-flex h-7 items-center justify-center whitespace-nowrap rounded-sm px-3 text-sm font-medium transition-colors ${ativo ? "bg-superficie text-texto shadow-controle" : "hover:text-texto"}`;
}

/** Abas segmentadas do shadcn (trilho cinza, aba ativa branca). Só dentro de componente "use client" (recebe função). */
export function Segmentos<T extends string>({ opcoes, valor, aoMudar }: { opcoes: { valor: T; rotulo: string }[]; valor: T; aoMudar: (v: T) => void }) {
  return (
    <div role="tablist" className={estiloSegmentos}>
      {opcoes.map((o) => (
        <button key={o.valor} type="button" role="tab" aria-selected={o.valor === valor} onClick={() => aoMudar(o.valor)} className={estiloSegmento(o.valor === valor)}>
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}
