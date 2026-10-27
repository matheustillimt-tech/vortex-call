import type { Passe } from "./tipos";

/** Botões da barra de baixo. */
export type Controle = "microfone" | "camera" | "tela" | "gravar" | "convite" | "avisos" | "fundo" | "mais" | "sair" | "chat";

/**
 * Quais botões cada papel vê e em que ordem. Centro: microfone, câmera, tela, gravar, fundo, mais e sair (sempre por
 * último, vermelho). Direita: chat. Espião não liga microfone nem câmera (só sair e chat). Tela: anfitrião e
 * participante da reunião instantânea, e só se o aparelho compartilha tela (celular não). Gravar: só o anfitrião, e
 * só quando a sala passa o alvo da gravação. Convite (link de convidado): só o anfitrião, e só na sala da equipe de
 * uma sessão (que passa `convite`). Avisos (sino "Avisar quando alguém entrar"): anfitrião e espião, só quando a sala
 * liga o aviso de entradas (sala da equipe e reunião instantânea do anfitrião); fica logo antes do "mais".
 */
export function controlesDaBarra(
  papel: Passe["papel"],
  opcoes: { gravacao: boolean; telaNoAparelho: boolean; convite?: boolean; avisos?: boolean },
): { centro: Controle[]; direita: Controle[] } {
  if (papel === "espiao") return { centro: opcoes.avisos ? ["avisos", "sair"] : ["sair"], direita: ["chat"] };
  const anfitriao = papel === "anfitriao";
  const centro: Controle[] = ["microfone", "camera"];
  if ((anfitriao || papel === "participante") && opcoes.telaNoAparelho) centro.push("tela");
  if (anfitriao && opcoes.gravacao) centro.push("gravar");
  if (anfitriao && opcoes.convite) centro.push("convite");
  centro.push("fundo");
  if (anfitriao && opcoes.avisos) centro.push("avisos");
  centro.push("mais", "sair");
  return { centro, direita: ["chat"] };
}

/** Itens do menu "Mais opções": configurações pra todos; silenciar todos só pro anfitrião. */
export function itensDoMais(papel: Passe["papel"]): ("configuracoes" | "silenciar_todos")[] {
  if (papel === "espiao") return [];
  return papel === "anfitriao" ? ["configuracoes", "silenciar_todos"] : ["configuracoes"];
}

export type TipoDispositivo = "audio" | "video" | "speaker";

const NOME_TIPO: Record<TipoDispositivo, string> = { audio: "Microfone", video: "Câmera", speaker: "Alto-falante" };

/** Nome do aparelho no menu. O Chrome prefixa "Default - " e "Communications - "; sem permissão o navegador não dá o
 *  nome (label vazio), aí vira "Microfone 1", "Câmera 2"… */
export function rotuloDispositivo(d: { label: string }, indice: number, tipo: TipoDispositivo): string {
  const label = d.label.trim();
  if (!label) return `${NOME_TIPO[tipo]} ${indice + 1}`;
  const padrao = /^default\s*-\s*/i;
  const comunicacao = /^communications\s*-\s*/i;
  if (padrao.test(label)) return `Padrão: ${label.replace(padrao, "")}`;
  if (comunicacao.test(label)) return `Comunicação: ${label.replace(comunicacao, "")}`;
  return label;
}

/** Tira aparelhos repetidos (mesmo `deviceId`) e os sem id, mantendo a ordem do navegador. */
export function dispositivosUnicos<T extends { deviceId: string }>(lista: readonly T[]): T[] {
  const vistos = new Set<string>();
  return lista.filter((d) => {
    if (!d.deviceId || vistos.has(d.deviceId)) return false;
    vistos.add(d.deviceId);
    return true;
  });
}

/** Texto do menu quando não há nenhum aparelho daquele tipo. */
export function textoSemDispositivo(tipo: TipoDispositivo): string {
  if (tipo === "audio") return "Nenhum microfone encontrado";
  if (tipo === "video") return "Nenhuma câmera encontrada";
  return "Nenhum alto-falante encontrado";
}

type PermissaoMidia =
  | "NOT_REQUESTED"
  | "ACCEPTED"
  | "DENIED"
  | "SYSTEM_DENIED"
  | "COULD_NOT_START"
  | "NO_DEVICES_AVAILABLE"
  | "CANCELED";

/**
 * Estado do botão de microfone/câmera (mesma regra do `RtkMicToggle`/`RtkCameraToggle` do kit): bloqueado pelo
 * navegador ou pelo sistema conta como desligado e o clique abre o aviso de permissão. `dica` é o tooltip.
 */
export function estadoMidia(
  tipo: "audio" | "video",
  ligado: boolean,
  permissao: PermissaoMidia | undefined,
): { ligado: boolean; bloqueado: boolean; dica: string } {
  const bloqueado = permissao === "DENIED" || permissao === "SYSTEM_DENIED";
  const nome = tipo === "audio" ? "microfone" : "câmera";
  const artigo = tipo === "audio" ? "o" : "a";
  let dica: string;
  if (bloqueado) dica = `O navegador bloqueou ${artigo} ${nome}`;
  else if (permissao === "COULD_NOT_START") dica = `Não deu para ligar ${artigo} ${nome}`;
  else if (permissao === "NO_DEVICES_AVAILABLE" && !ligado) dica = textoSemDispositivo(tipo);
  else dica = `${ligado ? "Desligar" : "Ligar"} ${nome}`;
  return { ligado: ligado && !bloqueado, bloqueado, dica };
}

/** Hora do canto esquerdo da barra ("08:20"). Sem fuso, usa o do aparelho. */
export function formatarRelogio(data: Date, fuso?: string): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: fuso }).format(data);
}
