"use client";
import { useEffect, useRef, useState } from "react";
import { SalaDinamica } from "@/app/_sala/carregar";
import { copiarTexto } from "@/app/_sala/copiar-texto";
import { telaSaidaReuniao, type MotivoSaida, type TelaSaidaConvidado } from "@/app/_sala/formatos";
import type { Marca, Passe } from "@/app/_sala/tipos";

/** `reuniaoId` só vem pra membro logado (é o alvo do botão Gravar do anfitrião); a pessoa de fora nunca recebe. */
type Props = { codigo: string; titulo: string; link: string; marca: Marca; membro: { nome: string } | null; reuniaoId: string | null };

type Fase =
  | { tipo: "formulario"; erro?: string }
  | { tipo: "entrando" }
  | { tipo: "na_sala"; passe: Passe }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "verificando" }
  | { tipo: "saida"; tela: TelaSaidaConvidado };

const CHAVE_NOME = "vc:nome-visitante";
const chaveVisitante = (codigo: string) => `vc:visitante:${codigo}`;

function ler(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string): void {
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    // sem armazenamento (janela anônima, bloqueio): vale só nesta aba
  }
}

function novoUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Id do visitante desta reunião neste navegador: o mesmo navegador volta com a mesma presença (a aba antiga cai),
 *  e duas pessoas diferentes nunca se derrubam. */
function idDoVisitante(codigo: string): string {
  const salvo = ler(chaveVisitante(codigo));
  if (salvo) return salvo;
  const id = novoUuid();
  gravar(chaveVisitante(codigo), id);
  return id;
}

export function MarcaTopo({ marca }: { marca: Marca }) {
  return marca.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- logo vem de URL configurada no painel
    <img src={marca.logoUrl} alt={marca.nome} className="h-8 w-auto max-w-48 object-contain" />
  ) : (
    <span className="text-xl font-bold tracking-tight" style={{ color: marca.cor }}>{marca.nome}</span>
  );
}

const estiloPrincipal = "rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

/** Reunião instantânea `/r/{codigo}`: membro logado entra direto como anfitrião; pessoa de fora digita o nome e
 *  entra como participante (sem sala de espera). Por cima da sala: "Copiar link" pra todos e, pro anfitrião,
 *  "Encerrar reunião". */
export function Reuniao({ codigo, titulo, link, marca, membro, reuniaoId }: Props) {
  const [fase, setFase] = useState<Fase>(membro ? { tipo: "entrando" } : { tipo: "formulario" });
  const [nome, setNome] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const visitante = useRef<{ nome: string; id: string } | null>(null);
  const papel = useRef<Passe["papel"] | null>(null);

  useEffect(() => {
    setNome(ler(CHAVE_NOME) ?? "");
  }, []);

  // Pede o passe e entra. Membro não manda corpo (o servidor usa o login); visitante manda nome e id. Se o servidor
  // não reconhecer o login do membro (400 pedindo nome), cai no formulário de visitante.
  useEffect(() => {
    if (fase.tipo !== "entrando") return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch(`/api/reunioes/entrar/${codigo}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(visitante.current ? { nome: visitante.current.nome, visitanteId: visitante.current.id } : {}),
        });
        if (cancelado) return;
        if (r.ok) {
          const passe = (await r.json()) as Passe;
          papel.current = passe.papel;
          setFase({ tipo: "na_sala", passe });
          return;
        }
        const j = (await r.json().catch(() => null)) as { erro?: string } | null;
        if (r.status === 409 || r.status === 404) setFase({ tipo: "saida", tela: "terminou" });
        else if (r.status === 400) setFase({ tipo: "formulario", erro: visitante.current ? (j?.erro ?? "Confira seu nome.") : undefined });
        else setFase({ tipo: "erro", mensagem: j?.erro ?? "Não conseguimos abrir a sala." });
      } catch {
        if (!cancelado) setFase({ tipo: "erro", mensagem: "Não conseguimos abrir a sala." });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [fase.tipo, codigo]);

  function entrarComoVisitante(e: React.FormEvent) {
    e.preventDefault();
    const limpo = nome.trim();
    if (limpo.length < 2 || limpo.length > 60) {
      setFase({ tipo: "formulario", erro: "Digite seu nome (de 2 a 60 letras)." });
      return;
    }
    gravar(CHAVE_NOME, limpo);
    visitante.current = { nome: limpo, id: idDoVisitante(codigo) };
    setFase({ tipo: "entrando" });
  }

  // "Encerrar para todos" do próprio kit (só o anfitrião tem) acaba a sessão do RealtimeKit mas não a reunião: o
  // anfitrião encerra a reunião também. Depois, expulso (outra aba ou "Encerrar reunião") e encerrada conferem o
  // estado da reunião antes de decidir a tela.
  async function aoSair(motivo: MotivoSaida) {
    if (motivo === "saiu") {
      setFase({ tipo: "saida", tela: "saiu" });
      return;
    }
    setFase({ tipo: "verificando" });
    if (motivo === "encerrada" && papel.current === "anfitriao") {
      try {
        await fetch(`/api/reunioes/encerrar/${codigo}`, { method: "POST" }); // 404/409: já acabou, tudo bem
      } catch {
        // sem resposta: o estado abaixo decide
      }
    }
    let estado: string | null = null;
    try {
      const r = await fetch(`/api/reunioes/estado/${codigo}`);
      if (r.ok) estado = ((await r.json()) as { estado?: string }).estado ?? null;
    } catch {
      // sem resposta: telaSaidaReuniao decide pelo motivo
    }
    setFase({ tipo: "saida", tela: telaSaidaReuniao(motivo, estado) });
  }

  async function copiarLink() {
    if (await copiarTexto(link)) {
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } else {
      window.prompt("Copie o link da reunião:", link);
    }
  }

  async function encerrar() {
    if (!window.confirm("Isso tira todo mundo da reunião e o link para de funcionar. Encerrar?")) return;
    setEncerrando(true);
    try {
      const r = await fetch(`/api/reunioes/encerrar/${codigo}`, { method: "POST" });
      // 409: outra pessoa da equipe (ou o cron) já encerrou.
      if (r.ok || r.status === 409) {
        setFase({ tipo: "saida", tela: "terminou" });
        return;
      }
      window.alert("Não conseguimos encerrar a reunião. Tente de novo.");
    } catch {
      window.alert("Não conseguimos encerrar a reunião. Tente de novo.");
    }
    setEncerrando(false);
  }

  if (fase.tipo === "na_sala") {
    return (
      <div className="relative h-dvh">
        <div className="fixed right-3 top-3 z-50 flex gap-2">
          <button
            type="button"
            onClick={() => void copiarLink()}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-md hover:bg-zinc-50"
          >
            {copiado ? "Link copiado!" : "Copiar link"}
          </button>
          {fase.passe.papel === "anfitriao" && (
            <button
              type="button"
              onClick={() => void encerrar()}
              disabled={encerrando}
              className="rounded-md bg-erro px-3 py-1.5 text-sm font-medium text-white shadow-md hover:bg-erro-hover disabled:opacity-50"
            >
              Encerrar reunião
            </button>
          )}
        </div>
        <SalaDinamica
          passe={fase.passe}
          marca={marca}
          aoSair={aoSair}
          gravacao={fase.passe.papel === "anfitriao" && reuniaoId ? { tipo: "reuniao", id: reuniaoId } : undefined}
          titulo={titulo}
          avisarEntradas={fase.passe.papel === "anfitriao"}
        />
      </div>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-white px-6 text-center">
      <MarcaTopo marca={marca} />

      {fase.tipo === "formulario" && (
        <form onSubmit={entrarComoVisitante} className="flex w-full max-w-xs flex-col gap-3">
          <h1 className="text-lg font-semibold text-zinc-900">{titulo}</h1>
          <label className="flex flex-col gap-1 text-left text-sm font-medium text-zinc-700">
            Seu nome
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={60}
              autoComplete="name"
              autoFocus
              required
              className="rounded-md border border-zinc-300 px-3 py-2 text-base font-normal text-zinc-900 outline-none focus:border-zinc-500"
            />
          </label>
          {fase.erro && <p className="text-sm text-erro">{fase.erro}</p>}
          <button type="submit" className={estiloPrincipal} style={{ backgroundColor: marca.cor }}>
            Entrar
          </button>
        </form>
      )}

      {(fase.tipo === "entrando" || fase.tipo === "verificando") && (
        <>
          <span className="size-6 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-600" aria-hidden />
          <p className="text-sm text-zinc-500">{fase.tipo === "entrando" ? "Preparando a sala…" : "Um instante…"}</p>
        </>
      )}

      {fase.tipo === "erro" && (
        <>
          <p className="text-base text-zinc-700">{fase.mensagem}</p>
          <button type="button" onClick={() => setFase({ tipo: membro || visitante.current ? "entrando" : "formulario" })} className={estiloPrincipal} style={{ backgroundColor: marca.cor }}>
            Tentar de novo
          </button>
        </>
      )}

      {fase.tipo === "saida" && (
        <>
          <p className="text-lg font-medium text-zinc-800">
            {fase.tela === "saiu"
              ? "Você saiu da reunião"
              : fase.tela === "outra_aba"
                ? "Você entrou em outra aba ou aparelho. Esta aba foi desconectada."
                : "A reunião terminou."}
          </p>
          {fase.tela === "saiu" && (
            <button type="button" onClick={() => setFase({ tipo: membro || visitante.current ? "entrando" : "formulario" })} className={estiloPrincipal} style={{ backgroundColor: marca.cor }}>
              Voltar
            </button>
          )}
          {membro && (
            <a href="/reunioes" className="text-sm text-zinc-500 underline">
              Ir para o painel
            </a>
          )}
        </>
      )}
    </main>
  );
}
