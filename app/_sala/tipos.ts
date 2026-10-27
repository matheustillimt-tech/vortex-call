import type { useRealtimeKitClient } from "@cloudflare/realtimekit-react";
import type { Passe as PasseDoServidor } from "@/src/lib/sala";
import type { MotivoSaida } from "./formatos";

/** Mesmo formato do `Passe` de `src/lib/sala.ts` (que é só do servidor). A checagem abaixo quebra o typecheck se os
 *  dois se separarem; o `import type` some no build, então nada do servidor vai pro navegador. */
export type Passe = { token: string; nome: string; papel: "convidado" | "anfitriao" | "espiao" | "participante"; transcreve?: boolean };
type Igual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const passeIgualAoDoServidor: Igual<Passe, PasseDoServidor> = true;
void passeIgualAoDoServidor;

export type Marca = { nome: string; logoUrl: string | null; cor: string };

export type { MotivoSaida };

export type SalaProps = {
  passe: Passe;
  marca: Marca;
  aoSair: (motivo: MotivoSaida) => void;
  /** Encaixe da coluna da ficha: só a sala da equipe passa (o convidado nunca recebe ficha nem roteiro). Fica dentro do RealtimeKitProvider. */
  colunaEsquerda?: React.ReactNode;
  /** Alvo do botão Gravar do anfitrião (`POST /api/sala/gravar/{id}`): sessão ou reunião. Sem ele, o anfitrião fica
   *  sem botão de gravar. */
  gravacao?: AlvoGravacao;
  /** Só a sala do convidado inscrito passa: conta microfone, câmera e mensagens dele e manda pro painel
   *  (`POST /api/sala/atividade/{codigo}`). Equipe e reunião instantânea não contam. */
  atividade?: { codigo: string };
  /** Nome da call no canto esquerdo da barra, ao lado da hora. Sem ele, só a hora. */
  titulo?: string;
  /** Só a sala da equipe de uma sessão passa: botão "Copiar link de convidado" do anfitrião. */
  convite?: { sessaoId: string };
  /** Avisar quando um cliente entra (sino na barra, som, notificação do sistema e título da aba). Só a sala da equipe
   *  e a reunião instantânea do anfitrião passam. */
  avisarEntradas?: boolean;
  /** Clicar no nome de um lead num quadro do palco abre a ficha dele na coluna (só a sala da equipe com `ficha`). */
  aoClicarLead?: (inscricaoId: string) => void;
};

export type AlvoGravacao = { tipo: "sessao" | "reuniao"; id: string };

/** O cliente do RealtimeKit (instância da reunião), sem importar o pacote core direto. */
export type Meeting = ReturnType<typeof useRealtimeKitClient>[0];
