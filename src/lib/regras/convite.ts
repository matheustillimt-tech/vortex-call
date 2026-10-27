import { randomBytes } from "node:crypto";
import { prazoFinal } from "./estado-sala";

/** Link de convidado da sessão (`/s/{codigo}`): o anfitrião manda pra um sócio ou parceiro, que entra sem login e
 *  sem inscrição enquanto a sessão está ao vivo. */

/** 16 bytes aleatórios em base64url: 22 caracteres, sem `/` nem `+` (vai direto na URL). */
export function gerarConvite(aleatorio: (n: number) => Uint8Array = (n) => randomBytes(n)): string {
  return Buffer.from(aleatorio(16)).toString("base64url");
}

export function ehConviteValido(c: unknown): c is string {
  return typeof c === "string" && /^[A-Za-z0-9_-]{22}$/.test(c);
}

/** `aguardando` = o anfitrião ainda não abriu a sala; `aberta` = ao vivo; `encerrada` = acabou, foi cancelada ou
 *  passou do prazo final (início + duração + 2 h, o mesmo da sala do lead). */
export type SituacaoConvite = "aguardando" | "aberta" | "encerrada";

export function situacaoConvite(o: { status: string; inicio: Date; duracaoMin: number | null; agora: Date }): SituacaoConvite {
  if (o.status !== "agendada" && o.status !== "ao_vivo") return "encerrada";
  if (o.duracaoMin !== null && o.agora.getTime() >= prazoFinal(o.inicio, o.duracaoMin).getTime()) return "encerrada";
  return o.status === "ao_vivo" ? "aberta" : "aguardando";
}
