import type { Metadata } from "next";

export const metadata: Metadata = { title: "Entrar · Vórtex Call", robots: { index: false, follow: false } };

export default function LayoutLogin({ children }: { children: React.ReactNode }) {
  return children;
}
