import { describe, expect, it } from "vitest";
import { interagiu, notaInteracao } from "@/src/lib/regras/interacao";

describe("notaInteracao", () => {
  it("nota cheia quando bate todos os tetos", () => {
    expect(notaInteracao({ minutos: 60, duracaoMin: 60, msgs: 5, micS: 120, camS: 1800 })).toBe(100);
  });

  it("passar dos tetos não passa de 100", () => {
    expect(notaInteracao({ minutos: 200, duracaoMin: 60, msgs: 50, micS: 9999, camS: 99999 })).toBe(100);
  });

  it("só tempo na sala pela metade = 20", () => {
    expect(notaInteracao({ minutos: 30, duracaoMin: 60, msgs: 0, micS: 0, camS: 0 })).toBe(20);
  });

  it("soma os pesos e arredonda", () => {
    // 40 × 45/60 = 30; 25 × 2/5 = 10; 20 × 60/120 = 10; 15 × 900/1800 = 7,5 → 57,5 → 58
    expect(notaInteracao({ minutos: 45, duracaoMin: 60, msgs: 2, micS: 60, camS: 900 })).toBe(58);
  });

  it("sem presença = 0", () => {
    expect(notaInteracao({ minutos: 60, duracaoMin: 60, msgs: 5, micS: 120, camS: 1800, veio: false })).toBe(0);
  });

  it("valores negativos contam como 0", () => {
    expect(notaInteracao({ minutos: -10, duracaoMin: 60, msgs: -1, micS: -5, camS: -5 })).toBe(0);
  });

  it("interagiu a partir de 30", () => {
    expect(interagiu(29)).toBe(false);
    expect(interagiu(30)).toBe(true);
  });
});
