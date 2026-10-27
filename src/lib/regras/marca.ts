/** Nome da sua empresa (`NEXT_PUBLIC_EMPRESA_NOME`), usado nos textos fixos: título do evento na agenda do Google,
 *  título da aba quando alguém entra na sala e o pedido pra IA resumir a call. Sem a variável, os textos saem sem o
 *  nome (nunca quebra). O nome que aparece na sala e na página de agendamento vem de Configurações (tabela
 *  `configuracao`). Lido com `process.env.NEXT_PUBLIC_...` literal pra o Next embutir o valor no navegador também. */
export function nomeEmpresa(): string {
  return (process.env.NEXT_PUBLIC_EMPRESA_NOME ?? "").trim();
}

/** Uma frase opcional sobre o que a empresa vende (`IA_SOBRE_A_EMPRESA`), que vai no pedido pra IA resumir a call.
 *  Só no servidor. */
export function sobreAEmpresa(): string {
  return (process.env.IA_SOBRE_A_EMPRESA ?? "").trim();
}
