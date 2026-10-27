export type SessaoVitrine = { id: string; inicio: string; vagas: number; inscritos: number; status: string };
export type ItemVitrine = { id: string; inicio: string; restantes: number; lotada: boolean };

/** O que o módulo mostra: sessões agendadas que ainda não começaram, com as vagas restantes. */
export function montarVitrine(sessoes: SessaoVitrine[], agora: Date, _duracaoMin: number): ItemVitrine[] {
  return sessoes
    .filter((s) => s.status === "agendada" && new Date(s.inicio).getTime() > agora.getTime())
    .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime())
    .map((s) => {
      const restantes = Math.max(0, s.vagas - s.inscritos);
      return { id: s.id, inicio: s.inicio, restantes, lotada: restantes === 0 };
    });
}
