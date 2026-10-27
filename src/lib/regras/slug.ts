/** Mensagem do problema, ou null se o slug serve. */
export function validarSlug(s: string): string | null {
  if (s.length < 3 || s.length > 60) return "Use de 3 a 60 caracteres.";
  if (!/^[a-z0-9-]+$/.test(s)) return "Use só letras minúsculas, números e hífen.";
  if (s.startsWith("-") || s.endsWith("-")) return "Não comece nem termine com hífen.";
  if (s.includes("--")) return "Não use dois hífens seguidos.";
  return null;
}

export function gerarSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** `base`, ou `base-2`, `base-3`… o primeiro que não estiver em `existentes` (sempre ≤ 60 caracteres). */
export function slugUnico(base: string, existentes: string[]): string {
  const ocupados = new Set(existentes);
  if (!ocupados.has(base)) return base;
  for (let n = 2; ; n++) {
    const sufixo = `-${n}`;
    const candidato = `${base.slice(0, 60 - sufixo.length).replace(/-+$/g, "")}${sufixo}`;
    if (!ocupados.has(candidato)) return candidato;
  }
}
