"use client";
import { useEffect, useRef, useState } from "react";
import { SalaDinamica } from "@/app/_sala/carregar";
import { telaSaidaConvite, type MotivoSaida, type TelaSaidaConvidado } from "@/app/_sala/formatos";
import type { Marca, Passe } from "@/app/_sala/tipos";
import { MarcaTopo } from "@/app/r/[codigo]/reuniao";
import { TEXTO_AGUARDANDO, TEXTO_TERMINOU } from "./textos";

type Fase =
  | { tipo: "formulario"; erro?: string }
  | { tipo: "entrando" }
  | { tipo: "na_sala"; passe: Passe }
  | { tipo: "aguardando" }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "verificando" }
  | { tipo: "saida"; tela: TelaSaidaConvidado };

const CHAVE_NOME = "vc:nome-visitante";
const chaveVisitante = (codigo: string) => `vc:convidado:${codigo}`;

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

/** Id do convidado neste navegador, por link: o mesmo navegador volta com a mesma presença (a aba antiga cai), e
 *  duas pessoas com o mesmo link nunca se derrubam. */
function idDoVisitante(codigo: string): string {
  const salvo = ler(chaveVisitante(codigo));
  if (salvo) return salvo;
  const id = novoUuid();
  gravar(chaveVisitante(codigo), id);
  return id;
}

const estiloPrincipal = "rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

/** Convidado de fora numa sessão (`/s/{codigo}`): digita o nome e entra como participante (fala, câmera, tela). */
export function Entrada({ codigo, titulo, marca }: { codigo: string; titulo: string; marca: Marca }) {
  const [fase, setFase] = useState<Fase>({ tipo: "formulario" });
  const [nome, setNome] = useState("");
  const visitante = useRef<{ nome: string; id: string } | null>(null);

  useEffect(() => {
    setNome(ler(CHAVE_NOME) ?? "");
  }, []);

  useEffect(() => {
    if (fase.tipo !== "entrando" || !visitante.current) return;
    const { nome: n, id } = visitante.current;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch(`/api/convite/${codigo}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: n, visitanteId: id }),
        });
        if (cancelado) return;
        if (r.ok) {
          setFase({ tipo: "na_sala", passe: (await r.json()) as Passe });
          return;
        }
        const j = (await r.json().catch(() => null)) as { erro?: string; estado?: string } | null;
        if (r.status === 409 && j?.estado === "aguardando") setFase({ tipo: "aguardando" });
        else if (r.status === 409 || r.status === 404) setFase({ tipo: "saida", tela: "terminou" });
        else if (r.status === 400) setFase({ tipo: "formulario", erro: j?.erro ?? "Confira seu nome." });
        else setFase({ tipo: "erro", mensagem: j?.erro ?? "Não conseguimos abrir a sala." });
      } catch {
        if (!cancelado) setFase({ tipo: "erro", mensagem: "Não conseguimos abrir a sala." });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [fase.tipo, codigo]);

  function entrar(e: React.FormEvent) {
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

  async function aoSair(motivo: MotivoSaida) {
    if (motivo === "saiu") {
      setFase({ tipo: "saida", tela: "saiu" });
      return;
    }
    setFase({ tipo: "verificando" });
    let estado: string | null = null;
    try {
      const r = await fetch(`/api/convite/${codigo}`);
      if (r.ok) estado = ((await r.json()) as { estado?: string }).estado ?? null;
      else if (r.status === 404) estado = "encerrada";
    } catch {
      // sem resposta: telaSaidaConvite decide pelo motivo
    }
    setFase({ tipo: "saida", tela: telaSaidaConvite(motivo, estado) });
  }

  const voltar = () => setFase(visitante.current ? { tipo: "entrando" } : { tipo: "formulario" });

  if (fase.tipo === "na_sala") {
    return <SalaDinamica passe={fase.passe} marca={marca} aoSair={aoSair} titulo={titulo} />;
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-white px-6 text-center">
      <MarcaTopo marca={marca} />

      {fase.tipo === "formulario" && (
        <form onSubmit={entrar} className="flex w-full max-w-xs flex-col gap-3">
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

      {(fase.tipo === "erro" || fase.tipo === "aguardando") && (
        <>
          <p className="max-w-sm text-base text-zinc-700">{fase.tipo === "erro" ? fase.mensagem : TEXTO_AGUARDANDO}</p>
          <button type="button" onClick={voltar} className={estiloPrincipal} style={{ backgroundColor: marca.cor }}>
            Tentar de novo
          </button>
        </>
      )}

      {fase.tipo === "saida" && (
        <>
          <p className="max-w-sm text-lg font-medium text-zinc-800">
            {fase.tela === "saiu"
              ? "Você saiu da call."
              : fase.tela === "outra_aba"
                ? "Você entrou em outra aba ou aparelho. Esta aba foi desconectada."
                : TEXTO_TERMINOU}
          </p>
          {fase.tela === "saiu" && (
            <button type="button" onClick={voltar} className={estiloPrincipal} style={{ backgroundColor: marca.cor }}>
              Voltar
            </button>
          )}
        </>
      )}
    </main>
  );
}
