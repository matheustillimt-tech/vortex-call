import { describe, expect, it } from "vitest";
import { ehFusoValido, formatarDataHora, formatarHora, formatarSessao, FUSOS, localParaUtc, utcParaLocal } from "@/src/lib/regras/fuso";

describe("fuso", () => {
  it("lista começa por Brasília e só tem fusos válidos", () => {
    expect(FUSOS[0].valor).toBe("America/Sao_Paulo");
    expect(FUSOS.every((f) => ehFusoValido(f.valor))).toBe(true);
  });

  it("reconhece fuso inválido", () => {
    expect(ehFusoValido("Marte/Base")).toBe(false);
    expect(ehFusoValido("America/Sao_Paulo")).toBe(true);
  });

  it("hora local de Brasília vira UTC", () => {
    expect(localParaUtc("2026-10-19T19:00", "America/Sao_Paulo")?.toISOString()).toBe("2026-10-19T22:00:00.000Z");
  });

  it("hora local de Lisboa no verão vira UTC", () => {
    expect(localParaUtc("2026-10-19T19:00", "Europe/Lisbon")?.toISOString()).toBe("2026-10-19T18:00:00.000Z");
  });

  it("texto inválido vira null", () => {
    expect(localParaUtc("", "America/Sao_Paulo")).toBeNull();
    expect(localParaUtc("19/10/2026", "America/Sao_Paulo")).toBeNull();
  });

  it("UTC volta para o horário local", () => {
    expect(utcParaLocal(new Date("2026-10-19T22:00:00Z"), "America/Sao_Paulo")).toBe("2026-10-19T19:00");
  });

  it("formata a sessão por extenso", () => {
    expect(formatarSessao(new Date("2026-10-19T22:00:00Z"), "America/Sao_Paulo")).toBe("segunda-feira, 19/10 às 19:00");
  });

  it("formata só a hora (HH:mm)", () => {
    expect(formatarHora(new Date("2026-10-19T22:00:00Z"), "America/Sao_Paulo")).toBe("19:00");
    expect(formatarHora(new Date("2026-10-19T18:00:00Z"), "Europe/Lisbon")).toBe("19:00");
  });

  it("data e hora completas em Brasília", () => {
    expect(formatarDataHora(new Date("2026-10-27T12:00:00Z"), "America/Sao_Paulo")).toBe("27/10/2026 às 09:00");
  });
});
