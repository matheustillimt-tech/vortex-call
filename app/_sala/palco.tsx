"use client";
import { useEffect, useMemo, useRef } from "react";
import { useRealtimeKitSelector } from "@cloudflare/realtimekit-react";
import {
  RtkAudioVisualizer,
  RtkGrid,
  RtkNameTag,
  RtkScreenshareView,
  RtkSimpleGrid,
  type Peer,
} from "@cloudflare/realtimekit-react-ui";
import { inscricaoDoCustomId } from "@/src/lib/regras/coluna";
import type { Meeting } from "./tipos";

/** Ids separados por vírgula: string muda só quando a lista muda, então o seletor não re-renderiza à toa. */
function idsCompartilhando(m: Meeting): string {
  const ids = m.participants.joined
    .toArray()
    .filter((p) => p.screenShareEnabled)
    .map((p) => p.id);
  if (m.self.screenShareEnabled) ids.push(m.self.id);
  return ids.join(",");
}

function idsNaGrade(m: Meeting): string {
  return [...m.participants.active.toArray().map((p) => p.id), m.self.id].join(",");
}

function pessoaPorId(m: Meeting, id: string): Peer | undefined {
  return id === m.self.id ? m.self : m.participants.joined.get(id);
}

/** A etiqueta de nome do kit (`rtk-name-tag`, dentro do shadow DOM da grade) por onde o evento passou, e a inscrição
 *  do lead dela (null: equipe, convidado de fora, eu). */
function etiquetaDoLead(e: Event): { etiqueta: HTMLElement; inscricaoId: string } | null {
  for (const alvo of e.composedPath()) {
    if (!(alvo instanceof HTMLElement) || alvo.tagName !== "RTK-NAME-TAG") continue;
    const pessoa = (alvo as HTMLElement & { participant?: { customParticipantId?: string | null } }).participant;
    const inscricaoId = inscricaoDoCustomId(pessoa?.customParticipantId);
    return inscricaoId ? { etiqueta: alvo, inscricaoId } : null;
  }
  return null;
}

/** Nome do lead no quadro vira link pra ficha (só a sala da equipe com a permissão `ficha` passa `aoClicarLead`): a
 *  grade é do kit, então o clique e a dica são pegos por delegação no palco, pelo caminho do evento. */
function useNomeAbreFicha(caixa: React.RefObject<HTMLDivElement | null>, aoClicarLead?: (inscricaoId: string) => void) {
  const aoClicar = useRef(aoClicarLead);
  useEffect(() => {
    aoClicar.current = aoClicarLead;
  }, [aoClicarLead]);
  const ligado = aoClicarLead !== undefined;

  useEffect(() => {
    const el = caixa.current;
    if (!el || !ligado) return;
    const sobre = (e: PointerEvent) => {
      const achou = etiquetaDoLead(e);
      if (!achou || achou.etiqueta.dataset.vcFicha) return;
      achou.etiqueta.dataset.vcFicha = "1";
      achou.etiqueta.style.cursor = "pointer";
      achou.etiqueta.title = "Ver ficha";
    };
    const clique = (e: MouseEvent) => {
      const achou = etiquetaDoLead(e);
      if (!achou) return;
      e.stopPropagation();
      aoClicar.current?.(achou.inscricaoId);
    };
    el.addEventListener("pointerover", sobre);
    el.addEventListener("click", clique);
    return () => {
      el.removeEventListener("pointerover", sobre);
      el.removeEventListener("click", clique);
    };
  }, [caixa, ligado]);
}

/**
 * Sem tela compartilhada: a grade do kit ocupa tudo (iniciais quando sem câmera, nome, microfone e barrinhas de fala
 * já vêm do quadro padrão). Com tela compartilhada: a tela grande à esquerda ("Tela - Nome") e as pessoas numa grade
 * estreita à direita (embaixo, no celular).
 */
export function Palco({ meeting, aoClicarLead }: { meeting: Meeting; aoClicarLead?: (inscricaoId: string) => void }) {
  const caixa = useRef<HTMLDivElement>(null);
  useNomeAbreFicha(caixa, aoClicarLead);
  const chaveTelas = useRealtimeKitSelector(idsCompartilhando);
  const chaveGrade = useRealtimeKitSelector(idsNaGrade);

  const tela = useMemo(() => {
    const [primeiro] = chaveTelas ? chaveTelas.split(",") : [];
    return primeiro ? pessoaPorId(meeting, primeiro) : undefined;
  }, [meeting, chaveTelas]);

  const pessoas = useMemo(
    () => (chaveGrade ? chaveGrade.split(",") : []).flatMap((id) => {
      const p = id === meeting.self.id ? meeting.self : meeting.participants.active.get(id);
      return p ? [p as Peer] : [];
    }),
    [meeting, chaveGrade],
  );

  if (!tela) {
    return (
      <div ref={caixa} className="vc-palco relative min-h-0 flex-1 p-3 max-pn-sm:p-2">
        <RtkGrid className="vc-grade size-full" meeting={meeting} gap={8} />
      </div>
    );
  }

  return (
    <div ref={caixa} className="vc-palco flex min-h-0 flex-1 gap-3 p-3 max-pn-sm:flex-col max-pn-sm:gap-2 max-pn-sm:p-2">
      <div className="relative min-h-0 min-w-0 flex-[7] overflow-hidden rounded-2xl bg-zinc-100">
        <RtkScreenshareView className="vc-tela size-full" meeting={meeting} participant={tela} nameTagPosition="bottom-left">
          <RtkNameTag meeting={meeting} participant={tela} isScreenShare>
            <RtkAudioVisualizer participant={tela} isScreenShare slot="start" />
          </RtkNameTag>
        </RtkScreenshareView>
      </div>
      <div className="relative min-h-0 min-w-0 flex-[3] max-pn-sm:flex-[2]">
        <RtkSimpleGrid className="vc-grade size-full" meeting={meeting} participants={pessoas} gap={8} />
      </div>
    </div>
  );
}
