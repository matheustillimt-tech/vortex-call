const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** Tempo decorrido da gravação: "mm:ss" até 59:59, depois "hh:mm:ss". */
export function formatarTempo(segundos: number): string {
  const total = Number.isFinite(segundos) && segundos > 0 ? Math.floor(segundos) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${doisDigitos(h)}:${doisDigitos(m)}:${doisDigitos(s)}` : `${doisDigitos(m)}:${doisDigitos(s)}`;
}

/** Contagem do topo da sala, contando a própria pessoa. */
export function rotuloPessoas(n: number): string {
  return n <= 1 ? "só você" : `${n} pessoas`;
}

export type MotivoSaida = "saiu" | "expulso" | "encerrada";

/** Traduz o `state` do evento `roomLeft` do RealtimeKit. `connected-meeting` é troca de sala (breakout), não saída. */
export function motivoDaSaida(estado: string): MotivoSaida | null {
  if (estado === "connected-meeting") return null;
  if (estado === "kicked") return "expulso";
  if (estado === "ended") return "encerrada";
  return "saiu";
}

export type TelaSaidaConvidado = "saiu" | "outra_aba" | "terminou";

/** O convidado é "expulso" tanto quando abre o link em outra aba quanto quando a equipe encerra a call para
 *  todos (kick-all). Quem chama consulta o estado da sala depois da expulsão: `acabou` quer dizer fim da call. */
export function telaSaidaConvidado(motivo: MotivoSaida, estado: string | null): TelaSaidaConvidado {
  if (motivo === "saiu") return "saiu";
  if (motivo === "encerrada") return "terminou";
  return estado === "acabou" ? "terminou" : "outra_aba";
}

export type TelaSaidaEquipe = "saiu" | "outra_aba" | "encerrada";

/** Mesmo raciocínio para a equipe, com o status da sessão: expulso de uma sessão que não está mais `ao_vivo` é
 *  call encerrada, não outra aba. */
export function telaSaidaEquipe(motivo: MotivoSaida, statusSessao: string | null): TelaSaidaEquipe {
  if (motivo === "saiu") return "saiu";
  if (motivo === "encerrada") return "encerrada";
  return statusSessao && statusSessao !== "ao_vivo" ? "encerrada" : "outra_aba";
}

/** Texto da tela de erro da entrada da equipe. 409 com a sessão ainda `agendada` para o espião quer dizer que o
 *  anfitrião ainda não abriu a sala; qualquer outro 409 é sessão fora do ar. */
export function mensagemErroEquipe(
  status: number,
  modo: "anfitriao" | "espiao",
  estado: string | undefined,
  erroServidor: string | undefined,
): string {
  if (status === 409) {
    if (modo === "espiao" && estado === "agendada") return "A sala ainda não foi aberta pelo anfitrião.";
    return "Esta call já foi encerrada.";
  }
  return erroServidor ?? "Não conseguimos abrir a sala.";
}

/** Reunião instantânea. Quem chama consulta o estado da reunião antes (e o anfitrião que usou "Encerrar para todos"
 *  do próprio kit já pediu o encerramento): `expulso` vem de "Encerrar reunião" (kick-all) ou de outra aba;
 *  `encerrada` é a sessão do RealtimeKit que acabou, mas se a reunião continua ativa a pessoa pode voltar. */
export function telaSaidaReuniao(motivo: MotivoSaida, estado: string | null): TelaSaidaConvidado {
  if (motivo === "saiu") return "saiu";
  if (motivo === "encerrada") return estado === "ativa" ? "saiu" : "terminou";
  return estado === "encerrada" ? "terminou" : "outra_aba";
}

/** Convidado de fora (`/s/{codigo}`), com o estado do link consultado depois da saída (`aguardando`, `aberta`,
 *  `encerrada`). Mesmo raciocínio da reunião instantânea: a sessão do RealtimeKit pode acabar com a call ainda ao
 *  vivo (dá pra voltar); expulso de uma call que não acabou é outra aba (ou o anfitrião tirou). */
export function telaSaidaConvite(motivo: MotivoSaida, estado: string | null): TelaSaidaConvidado {
  if (motivo === "saiu") return "saiu";
  if (motivo === "encerrada") return estado === "aberta" ? "saiu" : "terminou";
  return estado === "encerrada" ? "terminou" : "outra_aba";
}

/** Botão Gravar do anfitrião, pelo estado da gravação no RealtimeKit (`meeting.recording.recordingState`) e por um
 *  pedido nosso ainda em andamento. `ligar` é o que o clique pede pra rota. */
export function estadoBotaoGravar(
  estado: string,
  pedindo: boolean,
): { rotulo: string; ligar: boolean; ocupado: boolean; ativo: boolean } {
  if (estado === "STARTING") return { rotulo: "Começando", ligar: false, ocupado: true, ativo: true };
  if (estado === "STOPPING") return { rotulo: "Parando", ligar: true, ocupado: true, ativo: false };
  const gravando = estado === "RECORDING" || estado === "PAUSED";
  return { rotulo: gravando ? "Parar gravação" : "Gravar", ligar: !gravando, ocupado: pedindo, ativo: gravando };
}
