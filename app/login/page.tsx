"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { dbNavegador } from "@/src/lib/supabase/navegador";
import { Botao, CampoTexto } from "../(painel)/_componentes/ui";
import { Logo, Simbolo } from "../(painel)/_componentes/logo";

/** Login do painel: acima de 1100 px, metade esquerda escura com a marca e o cartão branco de
 *  460 px centrado na direita; abaixo, fundo cinza, logo em cima e o cartão na largura toda. Selos embaixo.
 *  Não tem "Esqueceu a senha?": a senha da equipe é trocada por um administrador. */
export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    const { error } = await dbNavegador().auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) return setErro("E-mail ou senha incorretos.");
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen bg-fundo text-sm text-texto">
      {/* Acima de 1100 px: metade esquerda escura com a marca. */}
      <div aria-hidden className="relative hidden w-1/2 flex-col items-center justify-center gap-5 overflow-hidden bg-[#18181B] pn-slg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(10,132,82,.35),transparent_55%),radial-gradient(circle_at_75%_85%,rgba(20,83,45,.45),transparent_50%)]" />
        <Simbolo tamanho={120} className="relative" />
        <Logo altura={44} className="relative !text-white" />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-8 py-12 max-pn-sm:px-4">
        <div className="w-[460px] max-w-full space-y-6 max-pn-slg:w-full">
          <div className="flex justify-center pn-slg:hidden">
            <Logo altura={36} />
          </div>
          <form onSubmit={entrar} className="space-y-6 rounded-lg border border-borda bg-superficie p-[23px]">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-titulo">Entrar</h1>
              <p className="text-sm text-texto-3">Insira seu e-mail abaixo para acessar sua conta.</p>
            </div>
            <div className="space-y-4">
              <CampoTexto rotulo="E-mail" type="email" autoComplete="email" placeholder="Insira seu e-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <CampoTexto
                rotulo="Senha"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
                dica="Esqueceu a senha? Peça a um administrador do sistema para trocar."
              />
            </div>
            {erro && (
              <p role="alert" className="rounded-md bg-erro-fundo px-3 py-2 text-sm text-erro">
                {erro}
              </p>
            )}
            <Botao type="submit" carregando={carregando} className="!h-10 w-full !bg-black !font-bold hover:!bg-black/85">
              {carregando ? "Entrando…" : "Entrar"}
            </Botao>
          </form>
          <div className="flex items-center justify-center gap-6 text-xs font-semibold uppercase tracking-wide text-texto-4">
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={16} aria-hidden className="text-marca" /> Site seguro
            </span>
            <span className="flex items-center gap-1.5">
              <LockKeyhole size={16} aria-hidden className="text-marca" /> Privacidade protegida
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
