"use client";
import { useEffect, useMemo, useState } from "react";
import { FileText, MessageSquareText, PanelLeftClose, PanelLeftOpen, Users } from "lucide-react";
import { useRealtimeKitSelector } from "@cloudflare/realtimekit-react";
import type { Meeting } from "@/app/_sala/tipos";
import {
  abaAtual,
  iniciais,
  juntarUserIds,
  separarPessoas,
  type Aba,
  type PessoaRtk,
  type PessoasDaCall,
} from "@/src/lib/regras/coluna";
import { FichaPessoa } from "./ficha";
import { AbaAlinhado, useTranscricao } from "./transcricao";

/** Quem está na call como texto: o seletor só re-renderiza quando a lista muda de verdade (mesmo truque do palco). */
function chavePessoas(m: Meeting): string {
  return JSON.stringify(
    m.participants.joined
      .toArray()
      .map((p): PessoaRtk => ({ id: p.id, userId: p.userId, nome: p.name, customId: p.customParticipantId ?? null })),
  );
}

/**
 * Coluna da equipe à esquerda da sala: "Pessoas" (quem está na call; clicar abre a ficha) e "Roteiro" (texto fixo
 * da agenda). Abre e fecha; no celular cobre a sala e começa fechada. Só a sala da equipe monta este componente.
 * Sem a permissão `ficha` (`verFicha` falso), só o "Roteiro" (a rota da ficha também recusa, com 403).
 * Sessão transcrita: aba "Alinhado" (permissão `transcricao`) e, no anfitrião, o envio das falas (`useTranscricao`).
 */
export function ColunaFicha({ sessaoId, roteiro, verFicha = true, pedido, transcricao }: {
  sessaoId: string;
  roteiro: string;
  verFicha?: boolean;
  /** Só sessão transcrita: `enviar` (anfitrião manda as falas) e `ver` (aba "Alinhado"). */
  transcricao?: { enviar: boolean; ver: boolean };
  /** Clique no nome do lead no palco: abre a coluna em "Pessoas" com a ficha dele (`n` muda a cada clique). */
  pedido?: { inscricaoId: string; n: number } | null;
}) {
  const [aberta, setAberta] = useState(() => window.innerWidth >= 768);
  const [escolhida, setEscolhida] = useState<Aba | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [userIds, setUserIds] = useState<Record<string, string[]>>({});
  const chave = useRealtimeKitSelector(chavePessoas);
  const pessoas = useMemo(() => separarPessoas(JSON.parse(chave) as PessoaRtk[]), [chave]);
  const verAlinhado = transcricao?.ver === true;
  const fala = useTranscricao({ sessaoId, enviar: transcricao?.enviar === true, ver: verAlinhado });

  useEffect(() => {
    setUserIds((antes) => juntarUserIds(antes, pessoas.convidados));
  }, [pessoas]);

  useEffect(() => {
    if (!pedido || !verFicha) return;
    setAberta(true);
    setEscolhida("pessoas");
    setSelecionada(pedido.inscricaoId);
  }, [pedido, verFicha]);

  const padrao: Aba = verFicha ? abaAtual(null, pessoas.convidados.length) : "roteiro";
  const aba: Aba =
    escolhida === "alinhado" ? (verAlinhado ? "alinhado" : padrao) : escolhida === "pessoas" && !verFicha ? "roteiro" : (escolhida ?? padrao);

  if (!aberta) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center border-r border-zinc-100 bg-white pt-2">
        <button
          type="button"
          onClick={() => setAberta(true)}
          aria-label="Abrir ficha"
          title="Abrir ficha"
          className="grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Ficha"
      className="flex w-80 shrink-0 flex-col border-r border-zinc-100 bg-white max-pn-sm:absolute max-pn-sm:inset-0 max-pn-sm:z-40 max-pn-sm:w-full max-pn-sm:border-r-0"
    >
      <div role="tablist" aria-label="Coluna da equipe" className="flex h-12 shrink-0 items-center gap-1 border-b border-zinc-100 px-2">
        {verFicha && (
          <BotaoAba ativa={aba === "pessoas"} onClick={() => setEscolhida("pessoas")} icone={<Users className="size-4" />}>
            Pessoas{pessoas.convidados.length > 0 ? ` (${pessoas.convidados.length})` : ""}
          </BotaoAba>
        )}
        {verAlinhado && (
          <BotaoAba ativa={aba === "alinhado"} onClick={() => setEscolhida("alinhado")} icone={<MessageSquareText className="size-4" />}>
            Alinhado
          </BotaoAba>
        )}
        <BotaoAba ativa={aba === "roteiro"} onClick={() => setEscolhida("roteiro")} icone={<FileText className="size-4" />}>
          Roteiro
        </BotaoAba>
        <button
          type="button"
          onClick={() => setAberta(false)}
          aria-label="Fechar ficha"
          title="Fechar ficha"
          className="ml-auto grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
        {aba === "alinhado" ? (
          <AbaAlinhado trechos={fala.trechos} parciais={fala.parciais} alinhado={fala.alinhado} />
        ) : aba === "roteiro" ? (
          <Roteiro texto={roteiro} />
        ) : selecionada ? (
          <FichaPessoa
            key={selecionada}
            sessaoId={sessaoId}
            inscricaoId={selecionada}
            userIds={userIds[selecionada] ?? []}
            voltar={() => setSelecionada(null)}
          />
        ) : (
          <ListaPessoas pessoas={pessoas} abrir={setSelecionada} />
        )}
      </div>
    </aside>
  );
}

function BotaoAba({ ativa, onClick, icone, children }: { ativa: boolean; onClick: () => void; icone: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium ${
        ativa ? "bg-marca-clara text-marca-forte" : "text-zinc-600 hover:bg-zinc-100"
      }`}
    >
      {icone}
      {children}
    </button>
  );
}

function Roteiro({ texto }: { texto: string }) {
  if (!texto.trim()) {
    return <p className="p-4 text-sm text-zinc-500">Esta agenda ainda não tem roteiro. Dá pra escrever no painel, em Agendas.</p>;
  }
  return <div className="whitespace-pre-wrap break-words p-4 text-sm leading-relaxed text-zinc-800">{texto}</div>;
}

function ListaPessoas({ pessoas, abrir }: { pessoas: PessoasDaCall; abrir: (inscricaoId: string) => void }) {
  return (
    <div className="p-3">
      <h3 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Na call agora</h3>
      {pessoas.convidados.length === 0 ? (
        <p className="px-1 text-sm text-zinc-500">Nenhum lead na call ainda.</p>
      ) : (
        <ul className="space-y-0.5">
          {pessoas.convidados.map((c) => (
            <li key={c.inscricaoId}>
              <button
                type="button"
                onClick={() => abrir(c.inscricaoId)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-marca-clara text-xs font-semibold text-marca-forte">
                  {iniciais(c.nome)}
                </span>
                <span className="truncate">{c.nome}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ListaSemFicha titulo="Equipe" selo="Equipe" nomes={pessoas.equipe} />
      <ListaSemFicha titulo="Convidados" selo="Convidado" nomes={pessoas.externos} />
    </div>
  );
}

/** Quem está na call sem ficha: a equipe e os convidados de fora (link de convidado do anfitrião, sem inscrição). */
function ListaSemFicha({ titulo, selo, nomes }: { titulo: string; selo: string; nomes: string[] }) {
  if (nomes.length === 0) return null;
  return (
    <>
      <h3 className="px-1 pb-2 pt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">{titulo}</h3>
      <ul className="space-y-0.5">
        {nomes.map((nome, i) => (
          <li key={`${nome}-${i}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-600">
            <span className="truncate">{nome}</span>
            <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">{selo}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
