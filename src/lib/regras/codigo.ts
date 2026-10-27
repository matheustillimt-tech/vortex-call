import { randomBytes } from "node:crypto";

/** Sem 0, 1, o, l, i: o lead pode ditar o código por telefone sem confusão. 31 símbolos. */
const ALFABETO = "23456789abcdefghjkmnpqrstuvwxyz";

export function gerarCodigo(aleatorio: (n: number) => Uint8Array = (n) => randomBytes(n)): string {
  const bytes = aleatorio(10);
  let s = "";
  for (let i = 0; i < 10; i++) s += ALFABETO[bytes[i] % ALFABETO.length];
  return s;
}

export function ehCodigoValido(c: string): boolean {
  return /^[a-z0-9]{10}$/.test(c);
}

/** 23505 (unique_violation) só é colisão de código se a constraint/mensagem citar "codigo" (ex.: inscricoes_codigo_key).
 *  Outra 23505 (ex.: inscricoes_uma_ativa_por_agenda) é um conflito de negócio de verdade: não adianta tentar de novo. */
export function ehColisaoDeCodigo(error: unknown): boolean {
  const e = error as { code?: string; message?: string; details?: string } | null;
  if (!e || e.code !== "23505") return false;
  const texto = `${e.message ?? ""} ${e.details ?? ""}`.toLowerCase();
  return texto.includes("codigo");
}
