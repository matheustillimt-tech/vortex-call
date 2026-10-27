/** Quem da equipe vê os dados de uma agenda: admin vê todas; membro só a que tem ele como responsável (vendedor).
 *  Mesma regra da função SQL `pode_ver_agenda` (migração 20261023200000_vendedor.sql): mudou lá, muda aqui. */
/** Estado vazio do membro que ainda não é responsável por nenhuma agenda. */
export const SEM_AGENDA_TEXTO = "Nenhuma agenda sua ainda.";
export const SEM_AGENDA_DETALHE = "Peça pro admin te colocar como responsável.";

/** Membro (responsável) só cancela sessão sem inscrito ativo; com inscritos, só o admin. */
export const TEM_INSCRITOS = "Essa sessão tem inscritos. Só o admin pode cancelar.";

/** `permissoes` (jsonb de `usuarios`): só conta pra `todas_agendas` e as outras chaves; ver regras/permissoes.ts. */
export type Quem = { id: string; papel: "admin" | "membro"; permissoes?: unknown };

export function podeVerAgenda(quem: Quem, responsavelId: string | null | undefined): boolean {
  if (quem.papel === "admin") return true;
  return !!responsavelId && responsavelId === quem.id;
}
