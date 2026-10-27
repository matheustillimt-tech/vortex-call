import { describe, expect, it } from "vitest";
import {
  controlesDaBarra,
  dispositivosUnicos,
  estadoMidia,
  formatarRelogio,
  itensDoMais,
  rotuloDispositivo,
  textoSemDispositivo,
} from "@/app/_sala/barra-regras";

describe("controlesDaBarra", () => {
  const tudo = { gravacao: true, telaNoAparelho: true };

  it("anfitrião (equipe ou reunião): microfone, câmera, tela, gravar, fundo, mais e sair por último; chat à direita", () => {
    expect(controlesDaBarra("anfitriao", tudo)).toEqual({
      centro: ["microfone", "camera", "tela", "gravar", "fundo", "mais", "sair"],
      direita: ["chat"],
    });
  });

  it("anfitrião sem alvo de gravação fica sem Gravar", () => {
    expect(controlesDaBarra("anfitriao", { gravacao: false, telaNoAparelho: true }).centro).not.toContain("gravar");
  });

  it("convidado (lead): sem tela e sem gravar, mesmo se a sala passar gravação", () => {
    expect(controlesDaBarra("convidado", tudo).centro).toEqual(["microfone", "camera", "fundo", "mais", "sair"]);
  });

  it("participante da reunião instantânea: compartilha tela, não grava", () => {
    expect(controlesDaBarra("participante", tudo).centro).toEqual(["microfone", "camera", "tela", "fundo", "mais", "sair"]);
  });

  it("espião: só sair e chat", () => {
    expect(controlesDaBarra("espiao", tudo)).toEqual({ centro: ["sair"], direita: ["chat"] });
  });

  it("aparelho sem compartilhamento de tela (celular) esconde Tela", () => {
    expect(controlesDaBarra("anfitriao", { gravacao: true, telaNoAparelho: false }).centro).not.toContain("tela");
  });

  it("link de convidado: só o anfitrião da sessão, depois de gravar", () => {
    const comConvite = { ...tudo, convite: true };
    expect(controlesDaBarra("anfitriao", comConvite).centro).toEqual(["microfone", "camera", "tela", "gravar", "convite", "fundo", "mais", "sair"]);
    expect(controlesDaBarra("anfitriao", tudo).centro).not.toContain("convite");
    for (const papel of ["convidado", "participante", "espiao"] as const) {
      expect(controlesDaBarra(papel, comConvite).centro).not.toContain("convite");
    }
  });

  it("sair é sempre o último do centro", () => {
    for (const papel of ["anfitriao", "convidado", "participante", "espiao"] as const) {
      expect(controlesDaBarra(papel, tudo).centro.at(-1)).toBe("sair");
    }
  });
});

describe("itensDoMais", () => {
  it("silenciar todos só pro anfitrião; espião sem menu", () => {
    expect(itensDoMais("anfitriao")).toEqual(["configuracoes", "silenciar_todos"]);
    expect(itensDoMais("convidado")).toEqual(["configuracoes"]);
    expect(itensDoMais("participante")).toEqual(["configuracoes"]);
    expect(itensDoMais("espiao")).toEqual([]);
  });
});

describe("rotuloDispositivo", () => {
  it("traduz os prefixos do Chrome", () => {
    expect(rotuloDispositivo({ label: "Default - MacBook Pro Microphone (Built-in)" }, 0, "audio")).toBe(
      "Padrão: MacBook Pro Microphone (Built-in)",
    );
    expect(rotuloDispositivo({ label: "Communications - Headset" }, 1, "speaker")).toBe("Comunicação: Headset");
  });

  it("mantém o nome do aparelho", () => {
    expect(rotuloDispositivo({ label: "FaceTime HD Camera" }, 0, "video")).toBe("FaceTime HD Camera");
  });

  it("sem nome (sem permissão): tipo + número", () => {
    expect(rotuloDispositivo({ label: "" }, 0, "audio")).toBe("Microfone 1");
    expect(rotuloDispositivo({ label: "  " }, 1, "video")).toBe("Câmera 2");
    expect(rotuloDispositivo({ label: "" }, 2, "speaker")).toBe("Alto-falante 3");
  });
});

describe("dispositivosUnicos", () => {
  it("tira repetidos e sem id, mantendo a ordem", () => {
    const lista = [{ deviceId: "a" }, { deviceId: "" }, { deviceId: "b" }, { deviceId: "a" }];
    expect(dispositivosUnicos(lista)).toEqual([{ deviceId: "a" }, { deviceId: "b" }]);
  });
});

describe("textoSemDispositivo", () => {
  it("um texto por tipo", () => {
    expect(textoSemDispositivo("audio")).toBe("Nenhum microfone encontrado");
    expect(textoSemDispositivo("video")).toBe("Nenhuma câmera encontrada");
    expect(textoSemDispositivo("speaker")).toBe("Nenhum alto-falante encontrado");
  });
});

describe("estadoMidia", () => {
  it("ligado e desligado com permissão", () => {
    expect(estadoMidia("audio", true, "ACCEPTED")).toEqual({ ligado: true, bloqueado: false, dica: "Desligar microfone" });
    expect(estadoMidia("video", false, "NOT_REQUESTED")).toEqual({ ligado: false, bloqueado: false, dica: "Ligar câmera" });
    expect(estadoMidia("audio", false, undefined).dica).toBe("Ligar microfone");
  });

  it("bloqueado pelo navegador ou sistema conta como desligado", () => {
    expect(estadoMidia("audio", true, "DENIED")).toEqual({ ligado: false, bloqueado: true, dica: "O navegador bloqueou o microfone" });
    expect(estadoMidia("video", false, "SYSTEM_DENIED")).toEqual({ ligado: false, bloqueado: true, dica: "O navegador bloqueou a câmera" });
  });

  it("não deu para ligar e sem aparelho", () => {
    expect(estadoMidia("video", false, "COULD_NOT_START").dica).toBe("Não deu para ligar a câmera");
    expect(estadoMidia("audio", false, "NO_DEVICES_AVAILABLE").dica).toBe("Nenhum microfone encontrado");
  });
});

describe("formatarRelogio", () => {
  it("hh:mm no fuso pedido", () => {
    expect(formatarRelogio(new Date("2026-10-26T11:20:00Z"), "America/Sao_Paulo")).toBe("08:20");
    expect(formatarRelogio(new Date("2026-10-26T23:05:00Z"), "America/Sao_Paulo")).toBe("20:05");
  });
});
