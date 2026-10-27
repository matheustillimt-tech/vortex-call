/** Cria a reunião instantânea (`POST /api/reunioes`) e abre a sala na mesma aba. Devolve a mensagem de erro, se
 *  não deu (quem chama mostra no toast); no sucesso, a página troca e nada volta. Sessão expirada (401): avisa e
 *  manda pro /login logo depois. Usado pelo botão "Reunião agora"
 *  do menu e pelo "Nova reunião" da lista. */
export async function criarEAbrirReuniao(titulo?: string): Promise<string | null> {
  try {
    const r = await fetch("/api/reunioes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(titulo ? { titulo } : {}),
    });
    const j = (await r.json().catch(() => null)) as { codigo?: string; erro?: string } | null;
    if (r.ok && j?.codigo) {
      window.location.href = `/r/${j.codigo}`;
      return null;
    }
    if (r.status === 401) {
      // Dá tempo de ler o aviso antes de ir pro login.
      window.setTimeout(() => {
        window.location.href = "/login";
      }, 2500);
      return "Sua sessão expirou. Faça login de novo.";
    }
    return j?.erro ?? "Não deu para criar a reunião.";
  } catch {
    return "Não deu para criar a reunião.";
  }
}
