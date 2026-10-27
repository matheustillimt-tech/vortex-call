import { describe, expect, it } from "vitest";
import { inicioDoPeriodo, periodoGravacoesDe } from "@/src/lib/regras/periodo-gravacoes";

describe("periodoGravacoesDe", () => {
  it("aceita os 3 valores válidos e cai em 7dias pra qualquer outra coisa", () => {
    expect(periodoGravacoesDe("24h")).toBe("24h");
    expect(periodoGravacoesDe("hoje")).toBe("hoje");
    expect(periodoGravacoesDe("7dias")).toBe("7dias");
    expect(periodoGravacoesDe(undefined)).toBe("7dias");
    expect(periodoGravacoesDe("30dias")).toBe("7dias");
    expect(periodoGravacoesDe(["hoje"])).toBe("7dias");
  });
});

describe("inicioDoPeriodo", () => {
  it('"7dias" devolve null (listarGravacoes já usa o padrão de 7 dias dela)', () => {
    expect(inicioDoPeriodo("7dias", new Date("2026-11-03T12:00:00Z"))).toBeNull();
  });

  it('"24h" é 24 horas corridas antes de agora', () => {
    expect(inicioDoPeriodo("24h", new Date("2026-11-03T12:00:00Z"))).toEqual(new Date("2026-11-02T12:00:00.000Z"));
  });

  it('"hoje" é a meia-noite de Brasília (UTC-3), não as últimas 24h', () => {
    // 2026-11-03T02:30:00Z é 2026-11-02 23:30 em Brasília: "hoje" ainda é dia 02.
    expect(inicioDoPeriodo("hoje", new Date("2026-11-03T02:30:00Z"))).toEqual(new Date("2026-11-02T03:00:00.000Z"));
    // 2026-11-03T12:00:00Z é 2026-11-03 09:00 em Brasília: "hoje" é dia 03, meia-noite local = 03:00 UTC.
    expect(inicioDoPeriodo("hoje", new Date("2026-11-03T12:00:00Z"))).toEqual(new Date("2026-11-03T03:00:00.000Z"));
  });
});
