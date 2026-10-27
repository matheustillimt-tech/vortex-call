"use client";
import { useId } from "react";

/**
 * Símbolo do Vórtex Call: um "V" com três pontos em cima, num quadrado verde com degradê.
 * Aparece no menu recolhido (68 px) e no favicon. O logo por extenso é a palavra (ver `Logo`).
 */
export function Simbolo({ tamanho = 28, className = "" }: { tamanho?: number; className?: string }) {
  // Id próprio por cópia: se o degradê ficasse num SVG escondido (gaveta fechada), as outras cópias perderiam a cor.
  const id = `gg${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 32 32" aria-hidden className={`shrink-0 ${className}`}>
      <defs>
        <linearGradient id={`${id}f`} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#13a066" />
          <stop offset="0.55" stopColor="#0a8452" />
          <stop offset="1" stopColor="#14532d" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id}f)`} />
      <path d="M9.4 12.4 16 24.2 22.6 12.4" fill="none" stroke="#fff" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12.3" cy="7.6" r="1.5" fill="#fff" fillOpacity="0.55" />
      <circle cx="16" cy="7.6" r="1.5" fill="#fff" fillOpacity="0.78" />
      <circle cx="19.7" cy="7.6" r="1.5" fill="#fff" />
    </svg>
  );
}

/** Logo em palavra na cor de marca (~215×28 no menu). `altura` é a do
 *  texto em px. */
export function Logo({ altura = 28, className = "" }: { altura?: number; className?: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap font-extrabold leading-none tracking-[-0.03em] text-marca ${className}`}
      style={{ fontSize: Math.round(altura * 0.93) }}
    >
      Vórtex Call
    </span>
  );
}
