/** Coluna "Anfitrião" (lista de sessões e detalhe): o nome de quem entrou primeiro como anfitrião; sessão que já
 *  começou sem ninguém = "Sem anfitrião" em alerta; futura ou cancelada sem ninguém = "—". */
export function rotuloAnfitriao(o: { nome: string | null | undefined; status: string; inicio: string; agora: Date }): { texto: string; aviso: boolean } {
  if (o.nome) return { texto: o.nome, aviso: false };
  if (o.status !== "cancelada" && Date.parse(o.inicio) <= o.agora.getTime()) return { texto: "Sem anfitrião", aviso: true };
  return { texto: "—", aviso: false };
}
