import { describe, expect, it } from "vitest";
import { proximaConsulta } from "@/app/c/[codigo]/consulta";

describe("proximaConsulta", () => {
  it("espera: entre 5s e 60s, como o tempo até abrir", () => {
    expect(proximaConsulta("espera", 30_000)).toBe(30_000);
  });

  it("espera: nunca menos de 5s", () => {
    expect(proximaConsulta("espera", 1_000)).toBe(5_000);
    expect(proximaConsulta("espera", 0)).toBe(5_000);
    expect(proximaConsulta("espera", -1_000)).toBe(5_000);
  });

  it("espera: nunca mais de 60s", () => {
    expect(proximaConsulta("espera", 120_000)).toBe(60_000);
  });

  it("aguardando_anfitriao: sempre 5s", () => {
    expect(proximaConsulta("aguardando_anfitriao", 999_999)).toBe(5_000);
  });

  it("aberta, acabou e cancelada: não consulta mais", () => {
    expect(proximaConsulta("aberta", 30_000)).toBe(0);
    expect(proximaConsulta("acabou", 30_000)).toBe(0);
    expect(proximaConsulta("cancelada", 30_000)).toBe(0);
  });
});
