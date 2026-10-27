/** Permissões por membro (24/10/2026). Admin tem tudo sempre; o membro tem o que está em `usuarios.permissoes`, e o
 *  que faltar lá vale o padrão daqui. Mesmos padrões da função SQL `permissao_padrao` (migração
 *  20261024120000_permissoes.sql, refeita em 20261026190000_transcricao_trechos.sql): mudou aqui, muda lá. */

export const PERMISSOES = [
  { chave: "dashboard", rotulo: "Ver o Início", descricao: "Os números das agendas dele", padrao: true },
  { chave: "receita", rotulo: "Ver receita e vendas", descricao: "Cartões de receita, compras e ticket", padrao: true },
  { chave: "anfitriao", rotulo: "Entrar como anfitrião", descricao: "Conduzir a call na sala", padrao: true },
  { chave: "espiao", rotulo: "Entrar como espião", descricao: "Assistir a call sem aparecer", padrao: true },
  { chave: "ficha", rotulo: "Ficha do lead", descricao: "Ver a ficha e escrever observações na call", padrao: true },
  { chave: "contato_lead", rotulo: "Ver contato do lead", descricao: "WhatsApp e e-mail completos (desligado: mascarados)", padrao: true },
  { chave: "horarios", rotulo: "Gerenciar horários", descricao: "Criar horários e sessões, mudar vagas, cancelar sessão sem inscritos", padrao: true },
  { chave: "gravacoes", rotulo: "Gravações", descricao: "Assistir e baixar as gravações das calls dele", padrao: true },
  { chave: "transcricao", rotulo: "Transcrição da call", descricao: "Ver a transcrição e o que foi alinhado (aba Alinhado da sala)", padrao: true },
  { chave: "reunioes", rotulo: "Reuniões instantâneas", descricao: "Criar reunião rápida (Reunião agora)", padrao: true },
  { chave: "todas_agendas", rotulo: "Ver todas as agendas", descricao: "Ver sessões de outras agendas, só leitura", padrao: false },
] as const;

export type ChavePermissao = (typeof PERMISSOES)[number]["chave"];
export type Permissoes = Record<ChavePermissao, boolean>;

export const CHAVES_PERMISSAO: ChavePermissao[] = PERMISSOES.map((p) => p.chave);
export const PERMISSOES_PADRAO: Permissoes = Object.fromEntries(PERMISSOES.map((p) => [p.chave, p.padrao])) as Permissoes;

/** Admin não tem modal de permissões: sempre tudo. */
export const ADMIN_TEM_TUDO = "Admin tem acesso a tudo";

/** Texto pra quem tenta algo sem a permissão (rotas devolvem 403 com ele; telas mostram). */
export const SEM_PERMISSAO = "Você não tem permissão pra isso. Fale com o admin.";

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** O que vem do banco (jsonb) → todas as chaves conhecidas. Valor que não é booleano vale o padrão; chave
 *  desconhecida é ignorada. */
export function lerPermissoes(v: unknown): Permissoes {
  const o = objeto(v);
  const r = { ...PERMISSOES_PADRAO };
  for (const c of CHAVES_PERMISSAO) if (typeof o[c] === "boolean") r[c] = o[c] as boolean;
  return r;
}

/** O que o admin mandou salvar: só as chaves conhecidas com booleano (o resto fica no padrão). */
export const limparPermissoes = lerPermissoes;

/** A pessoa pode? Admin sempre; membro pelo salvo (ou o padrão, se nada salvo). */
export function pode(quem: { papel: "admin" | "membro"; permissoes?: unknown }, chave: ChavePermissao): boolean {
  if (quem.papel === "admin") return true;
  return lerPermissoes(quem.permissoes)[chave];
}
