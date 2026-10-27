/** Regras puras do aviso "Fulano entrou" da equipe (rodam no navegador; nada de servidor aqui). */
import { nomeEmpresa } from "@/src/lib/regras/marca";

/** Quem entrou, como o RealtimeKit entrega (`participants.joined`). */
export type Entrada = { id: string; customId: string | null; nome: string };
/** Lead inscrito (uuid da inscrição), convidado do link do anfitrião (`convidado:`) e visitante da reunião
 *  instantânea (`visitante:`). Equipe (`membro:`), gravador e qualquer outro formato não avisam. */
export type TipoCliente = "lead" | "convidado" | "visitante";
export type Aviso = { chave: string; nome: string; primeiroNome: string; tipo: TipoCliente };

/** Logo depois de entrar, o kit entrega quem já estava na sala como "entrou": nada avisa nesse intervalo. */
export const CARENCIA_MS = 3_000;
/** Quem já estava na sala quando eu entrei não avisa nesse começo, mesmo que o kit repita a entrada. */
export const CARENCIA_PRESENTES_MS = 15_000;
/** A mesma pessoa de novo (reconexão, recarregou a página) não avisa duas vezes nesse intervalo. */
export const REPETIDA_MS = 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function tipoCliente(customId: string | null | undefined): TipoCliente | null {
  if (!customId) return null;
  if (customId.startsWith("convidado:")) return "convidado";
  if (customId.startsWith("visitante:")) return "visitante";
  if (UUID.test(customId)) return "lead";
  return null;
}

/** Nome pra mostrar: o que veio da inscrição (lead) ou o que a pessoa digitou (convidado); vazio vira "Alguém". */
export function nomeDeQuemEntrou(nome: string | null | undefined): string {
  const limpo = (nome ?? "").trim().replace(/\s+/g, " ");
  return limpo || "Alguém";
}

export function primeiroNome(nome: string): string {
  return nomeDeQuemEntrou(nome).split(" ")[0];
}

/** Título da aba enquanto ela está escondida: "(2) Ana entrou · Sua Empresa" (`NEXT_PUBLIC_EMPRESA_NOME`; sem ela,
 *  "· Vórtex Call"). */
export function tituloComAvisos(naoVistos: number, primeiro: string): string {
  return `(${naoVistos}) ${primeiro} entrou · ${nomeEmpresa() || "Vórtex Call"}`;
}

/** Chave da pessoa (não da conexão): a mesma inscrição/convidado volta com outro `id` ao reconectar. */
function chaveDe(p: Entrada): string {
  return (p.customId ?? p.id).toLowerCase();
}

export type Vigia = {
  /** Hora em que eu entrei na sala (null: ainda entrando, nada avisa). */
  entreiEm: number | null;
  presentes: Set<string>;
  avisados: Map<string, number>;
};

export function novoVigia(): Vigia {
  return { entreiEm: null, presentes: new Set(), avisados: new Map() };
}

/** Eu entrei: guarda a hora e quem já estava na sala. */
export function marcarQueEntrei(v: Vigia, agora: number, jaNaSala: readonly Entrada[]): void {
  v.entreiEm = agora;
  v.presentes = new Set(jaNaSala.map(chaveDe));
}

/** Decide se essa entrada avisa (e já registra, pra não avisar de novo). Eu mesmo, equipe, entradas antes de eu
 *  entrar, a carência do começo e a mesma pessoa repetida em menos de `REPETIDA_MS` não avisam. */
export function avaliarEntrada(v: Vigia, p: Entrada, o: { agora: number; euId: string | null | undefined }): Aviso | null {
  if (v.entreiEm === null) return null;
  if (o.euId && p.id === o.euId) return null;
  const tipo = tipoCliente(p.customId);
  if (!tipo) return null;
  const desde = o.agora - v.entreiEm;
  if (desde < CARENCIA_MS) return null;
  const chave = chaveDe(p);
  if (desde < CARENCIA_PRESENTES_MS && v.presentes.has(chave)) return null;
  const ultimo = v.avisados.get(chave);
  if (ultimo !== undefined && o.agora - ultimo < REPETIDA_MS) return null;
  v.avisados.set(chave, o.agora);
  const nome = nomeDeQuemEntrou(p.nome);
  return { chave, nome, primeiroNome: primeiroNome(nome), tipo };
}

export type PermissaoAviso = "granted" | "denied" | "default" | "sem_suporte";

/** Preferência salva: "0" desligado; qualquer outra coisa (ou nada salvo) = ligado (padrão). */
export function preferenciaLigada(salvo: string | null): boolean {
  return salvo !== "0";
}

/** O sino da barra: o que o clique faz e o que o tooltip diz. Ligado sem permissão pedida: o clique pede a
 *  permissão do navegador (precisa de clique). Bloqueado: som e título da aba continuam valendo. */
export function estadoSino(
  ligado: boolean,
  permissao: PermissaoAviso,
): { acao: "ligar" | "desligar" | "pedir"; rotulo: string; ativo: boolean } {
  if (!ligado) return { acao: "ligar", rotulo: "Avisar quando alguém entrar", ativo: false };
  if (permissao === "default") return { acao: "pedir", rotulo: "Avisar quando alguém entrar (clique pra permitir notificações)", ativo: true };
  if (permissao === "denied") return { acao: "desligar", rotulo: "Notificações bloqueadas no navegador", ativo: true };
  return { acao: "desligar", rotulo: "Parar de avisar quando alguém entrar", ativo: true };
}
