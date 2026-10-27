// Só navegador: usado pela sala pública (/r) e pelo painel, sem puxar os componentes do painel pra página pública.

/** Copia pela API do navegador; se ela falhar (página sem foco, contexto sem HTTPS), tenta o `execCommand` antigo. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}
