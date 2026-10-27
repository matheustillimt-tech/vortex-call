"use client";
import dynamic from "next/dynamic";
import { Carregando } from "./carregando";
import type { SalaProps } from "./tipos";

export { Carregando };

/** A sala só existe no navegador (WebRTC e web components do RealtimeKit): nada dela roda no servidor. */
export const SalaDinamica = dynamic<SalaProps>(() => import("./sala").then((m) => m.Sala), {
  ssr: false,
  loading: () => <Carregando texto="Preparando a sala…" />,
});
