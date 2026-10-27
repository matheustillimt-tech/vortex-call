import { describe, expect, it } from "vitest";
import { formatarTempo, motivoDaSaida, rotuloPessoas } from "@/app/_sala/formatos";

describe("formatarTempo", () => {
  it("menos de uma hora: mm:ss", () => {
    expect(formatarTempo(0)).toBe("00:00");
    expect(formatarTempo(1)).toBe("00:01");
    expect(formatarTempo(569)).toBe("09:29");
    expect(formatarTempo(3599)).toBe("59:59");
  });

  it("uma hora ou mais: hh:mm:ss", () => {
    expect(formatarTempo(3600)).toBe("01:00:00");
    expect(formatarTempo(3723)).toBe("01:02:03");
  });

  it("descarta fração e valores negativos ou inválidos viram zero", () => {
    expect(formatarTempo(61.9)).toBe("01:01");
    expect(formatarTempo(-5)).toBe("00:00");
    expect(formatarTempo(Number.NaN)).toBe("00:00");
  });
});

describe("rotuloPessoas", () => {
  it("uma pessoa (ou menos) é só você", () => {
    expect(rotuloPessoas(1)).toBe("só você");
    expect(rotuloPessoas(0)).toBe("só você");
  });

  it("duas ou mais: N pessoas", () => {
    expect(rotuloPessoas(2)).toBe("2 pessoas");
    expect(rotuloPessoas(12)).toBe("12 pessoas");
  });
});

describe("motivoDaSaida", () => {
  it("kicked é expulso e ended é encerrada", () => {
    expect(motivoDaSaida("kicked")).toBe("expulso");
    expect(motivoDaSaida("ended")).toBe("encerrada");
  });

  it("qualquer outro estado é saiu", () => {
    for (const estado of ["left", "rejected", "disconnected", "failed", "stageLeft"]) {
      expect(motivoDaSaida(estado)).toBe("saiu");
    }
  });

  it("troca de meeting conectada não é saída", () => {
    expect(motivoDaSaida("connected-meeting")).toBeNull();
  });
});

describe("telaSaidaConvidado", () => {
  it("expulso com a call acabada é 'terminou' (encerrar para todos), senão 'outra_aba'", async () => {
    const { telaSaidaConvidado } = await import("@/app/_sala/formatos");
    expect(telaSaidaConvidado("expulso", "acabou")).toBe("terminou");
    expect(telaSaidaConvidado("expulso", "aberta")).toBe("outra_aba");
    expect(telaSaidaConvidado("expulso", null)).toBe("outra_aba");
  });
  it("saiu e encerrada não dependem do estado", async () => {
    const { telaSaidaConvidado } = await import("@/app/_sala/formatos");
    expect(telaSaidaConvidado("saiu", "acabou")).toBe("saiu");
    expect(telaSaidaConvidado("encerrada", null)).toBe("terminou");
  });
});

describe("telaSaidaEquipe", () => {
  it("expulso com a sessão fora do ar é 'encerrada', ainda ao vivo é 'outra_aba'", async () => {
    const { telaSaidaEquipe } = await import("@/app/_sala/formatos");
    expect(telaSaidaEquipe("expulso", "encerrada")).toBe("encerrada");
    expect(telaSaidaEquipe("expulso", "ao_vivo")).toBe("outra_aba");
    expect(telaSaidaEquipe("expulso", null)).toBe("outra_aba");
  });
  it("saiu e encerrada não dependem do status", async () => {
    const { telaSaidaEquipe } = await import("@/app/_sala/formatos");
    expect(telaSaidaEquipe("saiu", "encerrada")).toBe("saiu");
    expect(telaSaidaEquipe("encerrada", "ao_vivo")).toBe("encerrada");
  });
});

describe("mensagemErroEquipe", () => {
  it("espião com 409 e sessão agendada: sala ainda não aberta", async () => {
    const { mensagemErroEquipe } = await import("@/app/_sala/formatos");
    expect(mensagemErroEquipe(409, "espiao", "agendada", "x")).toBe("A sala ainda não foi aberta pelo anfitrião.");
  });
  it("409 com sessão fora do ar: call encerrada", async () => {
    const { mensagemErroEquipe } = await import("@/app/_sala/formatos");
    expect(mensagemErroEquipe(409, "espiao", "encerrada", "x")).toBe("Esta call já foi encerrada.");
    expect(mensagemErroEquipe(409, "anfitriao", "ao_vivo", "x")).toBe("Esta call já foi encerrada.");
  });
  it("outros erros usam a mensagem do servidor ou a padrão", async () => {
    const { mensagemErroEquipe } = await import("@/app/_sala/formatos");
    expect(mensagemErroEquipe(502, "anfitriao", undefined, "Tente de novo.")).toBe("Tente de novo.");
    expect(mensagemErroEquipe(500, "anfitriao", undefined, undefined)).toBe("Não conseguimos abrir a sala.");
  });
});

describe("telaSaidaReuniao", () => {
  it("expulso: reunião encerrada é 'terminou' (Encerrar reunião faz kick-all), ainda ativa ou sem resposta é 'outra_aba'", async () => {
    const { telaSaidaReuniao } = await import("@/app/_sala/formatos");
    expect(telaSaidaReuniao("expulso", "encerrada")).toBe("terminou");
    expect(telaSaidaReuniao("expulso", "ativa")).toBe("outra_aba");
    expect(telaSaidaReuniao("expulso", null)).toBe("outra_aba");
  });
  it("encerrada (sessão do RealtimeKit acabou) com a reunião ainda ativa é 'saiu' (dá pra voltar); encerrada ou sem resposta é 'terminou'", async () => {
    const { telaSaidaReuniao } = await import("@/app/_sala/formatos");
    expect(telaSaidaReuniao("encerrada", "ativa")).toBe("saiu");
    expect(telaSaidaReuniao("encerrada", "encerrada")).toBe("terminou");
    expect(telaSaidaReuniao("encerrada", null)).toBe("terminou");
  });
  it("saiu não depende do estado", async () => {
    const { telaSaidaReuniao } = await import("@/app/_sala/formatos");
    expect(telaSaidaReuniao("saiu", "encerrada")).toBe("saiu");
  });
});

describe("estadoBotaoGravar", () => {
  it("parado: Gravar (liga); gravando ou pausado: Parar gravação (desliga)", async () => {
    const { estadoBotaoGravar } = await import("@/app/_sala/formatos");
    expect(estadoBotaoGravar("IDLE", false)).toEqual({ rotulo: "Gravar", ligar: true, ocupado: false, ativo: false });
    expect(estadoBotaoGravar("RECORDING", false)).toEqual({ rotulo: "Parar gravação", ligar: false, ocupado: false, ativo: true });
    expect(estadoBotaoGravar("PAUSED", false).ligar).toBe(false);
  });
  it("pedido em andamento ou transição do RealtimeKit: ocupado", async () => {
    const { estadoBotaoGravar } = await import("@/app/_sala/formatos");
    expect(estadoBotaoGravar("IDLE", true).ocupado).toBe(true);
    expect(estadoBotaoGravar("STARTING", false)).toMatchObject({ rotulo: "Começando", ocupado: true });
    expect(estadoBotaoGravar("STOPPING", false)).toMatchObject({ rotulo: "Parando", ocupado: true });
  });
});

describe("telaSaidaConvite", () => {
  it("expulso: call encerrada é 'terminou' (Encerrar para todos faz kick-all); ainda aberta ou sem resposta é 'outra_aba'", async () => {
    const { telaSaidaConvite } = await import("@/app/_sala/formatos");
    expect(telaSaidaConvite("expulso", "encerrada")).toBe("terminou");
    expect(telaSaidaConvite("expulso", "aberta")).toBe("outra_aba");
    expect(telaSaidaConvite("expulso", null)).toBe("outra_aba");
  });
  it("encerrada com a sessão ainda ao vivo é 'saiu' (dá pra voltar); senão 'terminou'", async () => {
    const { telaSaidaConvite } = await import("@/app/_sala/formatos");
    expect(telaSaidaConvite("encerrada", "aberta")).toBe("saiu");
    expect(telaSaidaConvite("encerrada", "encerrada")).toBe("terminou");
    expect(telaSaidaConvite("encerrada", null)).toBe("terminou");
    expect(telaSaidaConvite("saiu", "encerrada")).toBe("saiu");
  });
});
