import { describe, expect, it } from "vitest";
import { criarAcumulador } from "@/app/_sala/atividade";
import { formatarSegundos } from "@/src/lib/regras/atividade";

describe("criarAcumulador", () => {
  it("sem nada ligado colhe zero", () => {
    const a = criarAcumulador();
    expect(a.colher(10_000)).toEqual({ mic: 0, cam: 0, msgs: 0 });
  });

  it("soma o intervalo ligado/desligado e zera depois de colher", () => {
    const a = criarAcumulador();
    a.marcarAudio(true, 1_000);
    a.marcarAudio(false, 11_000);
    a.marcarVideo(true, 2_000);
    a.marcarVideo(false, 7_000);
    expect(a.colher(20_000)).toEqual({ mic: 10, cam: 5, msgs: 0 });
    expect(a.colher(30_000)).toEqual({ mic: 0, cam: 0, msgs: 0 });
  });

  it("ligado na hora de colher conta até agora e segue contando", () => {
    const a = criarAcumulador();
    a.marcarAudio(true, 0);
    expect(a.colher(30_000).mic).toBe(30);
    expect(a.colher(45_000).mic).toBe(15);
    a.marcarAudio(false, 50_000);
    expect(a.colher(90_000).mic).toBe(5);
  });

  it("vários liga/desliga somam; ligar de novo sem desligar não reinicia", () => {
    const a = criarAcumulador();
    a.marcarVideo(true, 0);
    a.marcarVideo(true, 3_000);
    a.marcarVideo(false, 4_000);
    a.marcarVideo(false, 9_000);
    a.marcarVideo(true, 10_000);
    a.marcarVideo(false, 12_500);
    expect(a.colher(20_000).cam).toBe(6);
  });

  it("guarda o resto de menos de 1 s pra próxima colheita", () => {
    const a = criarAcumulador();
    a.marcarAudio(true, 0);
    a.marcarAudio(false, 1_600);
    expect(a.colher(2_000).mic).toBe(1);
    a.marcarAudio(true, 3_000);
    a.marcarAudio(false, 3_500);
    expect(a.colher(4_000).mic).toBe(1);
    expect(a.colher(5_000).mic).toBe(0);
  });

  it("conta mensagens e zera ao colher", () => {
    const a = criarAcumulador();
    a.mensagemEnviada();
    a.mensagemEnviada();
    a.mensagemEnviada();
    expect(a.colher(1_000)).toEqual({ mic: 0, cam: 0, msgs: 3 });
    expect(a.colher(2_000).msgs).toBe(0);
  });
});

describe("formatarSegundos", () => {
  it("formata pro painel", () => {
    expect(formatarSegundos(0)).toBe("—");
    expect(formatarSegundos(45)).toBe("45 s");
    expect(formatarSegundos(120)).toBe("2 min");
    expect(formatarSegundos(185)).toBe("3 min 05 s");
    expect(formatarSegundos(3720)).toBe("1 h 02 min");
  });
});
