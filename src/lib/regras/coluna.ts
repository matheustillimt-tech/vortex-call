/** Regras puras da coluna da ficha (rodam no navegador; nada de servidor aqui). */

export type PessoaRtk = { id: string; userId: string; nome: string; customId: string | null };
export type Convidado = { inscricaoId: string; nome: string; userId: string };
/** `externos`: convidados de fora pelo link do anfitrião (`convidado:<hash>`), sem inscrição e sem ficha. */
export type PessoasDaCall = { convidados: Convidado[]; equipe: string[]; externos: string[] };
export type Aba = "pessoas" | "roteiro" | "alinhado";
/** Subconjunto do `Message` do RealtimeKit (`meeting.chat.messages`). */
export type MensagemChat = { id: string; userId: string; time: Date; type: string; message?: string; targetUserIds?: string[] };
export type LinhaChat = { id: string; hora: string; texto: string; privada: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const porNome = (a: string, b: string) => a.localeCompare(b, "pt-BR");

/** Id da inscrição do lead a partir do `customParticipantId` (uuid, em minúsculas). Equipe (`membro:`), convidado de
 *  fora (`convidado:`), visitante, gravador e vazio: null (não têm ficha). */
export function inscricaoDoCustomId(customId: string | null | undefined): string | null {
  return customId && UUID.test(customId) ? customId.toLowerCase() : null;
}

/** Quem está na call: convidado = `customParticipantId` uuid (id da inscrição); equipe = `membro:<id>`; convidado de
 *  fora (link do anfitrião, `/s/{codigo}`) = `convidado:<hash>`, sem ficha. Gravador e qualquer outro formato ficam
 *  de fora. A mesma inscrição duas vezes (reconexão) conta uma, a mais recente. */
export function separarPessoas(lista: PessoaRtk[]): PessoasDaCall {
  const convidados = new Map<string, Convidado>();
  const equipe = new Map<string, string>();
  const externos = new Map<string, string>();
  for (const p of lista) {
    if (!p.customId) continue;
    if (p.customId.startsWith("membro:")) equipe.set(p.customId, p.nome);
    else if (p.customId.startsWith("convidado:")) externos.set(p.customId, p.nome);
    else {
      const inscricaoId = inscricaoDoCustomId(p.customId);
      if (!inscricaoId) continue;
      convidados.set(inscricaoId, { inscricaoId, nome: p.nome, userId: p.userId });
    }
  }
  return {
    convidados: [...convidados.values()].sort((a, b) => porNome(a.nome, b.nome)),
    equipe: [...equipe.values()].sort(porNome),
    externos: [...externos.values()].sort(porNome),
  };
}

/** Enquanto ninguém clicou numa aba: sem convidado na call abre o Roteiro; com convidado, Pessoas. */
export function abaAtual(escolhida: Aba | null, totalConvidados: number): Aba {
  return escolhida ?? (totalConvidados > 0 ? "pessoas" : "roteiro");
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return `${primeira}${ultima}`.toUpperCase();
}

/** Guarda todos os `userId` que cada inscrição já teve nesta aba (quem recarrega a página ganha participante novo),
 *  pra achar as mensagens antigas dela no chat. Nada novo → devolve o mesmo objeto (o `setState` não re-renderiza). */
export function juntarUserIds(antes: Record<string, string[]>, convidados: Convidado[]): Record<string, string[]> {
  let mudou = false;
  const depois: Record<string, string[]> = { ...antes };
  for (const c of convidados) {
    const lista = depois[c.inscricaoId] ?? [];
    if (!c.userId || lista.includes(c.userId)) continue;
    depois[c.inscricaoId] = [...lista, c.userId];
    mudou = true;
  }
  return mudou ? depois : antes;
}

const HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

/** O que a pessoa escreveu no chat desta call (o que este navegador recebeu), com hora de Brasília. */
export function mensagensDaPessoa(mensagens: readonly MensagemChat[], userIds: readonly string[]): LinhaChat[] {
  if (userIds.length === 0) return [];
  return mensagens
    .filter((m) => userIds.includes(m.userId))
    .map((m) => ({
      id: m.id,
      hora: HORA.format(new Date(m.time)),
      texto: m.type === "image" ? "[imagem]" : m.type === "file" ? "[arquivo]" : (m.message ?? "").trim(),
      privada: (m.targetUserIds?.length ?? 0) > 0,
    }))
    .filter((l) => l.texto !== "");
}
