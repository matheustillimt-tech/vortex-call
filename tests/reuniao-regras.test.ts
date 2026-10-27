import { describe, expect, it } from "vitest";
import { ehVisitanteId, limparNomeVisitante, limparTitulo, situacaoReuniao, VALIDADE_REUNIAO_MS } from "@/src/lib/regras/reuniao";

describe("limparNomeVisitante", () => {
  it("corta espaços das pontas e aceita de 2 a 60 caracteres", () => {
    expect(limparNomeVisitante("  Ana  ")).toBe("Ana");
    expect(limparNomeVisitante("Jo")).toBe("Jo");
    expect(limparNomeVisitante("a".repeat(60))).toBe("a".repeat(60));
  });
  it("recusa curto, longo, só espaços e não-texto", () => {
    expect(limparNomeVisitante("A")).toBeNull();
    expect(limparNomeVisitante(" A ")).toBeNull();
    expect(limparNomeVisitante("a".repeat(61))).toBeNull();
    expect(limparNomeVisitante("      ")).toBeNull();
    expect(limparNomeVisitante(undefined)).toBeNull();
    expect(limparNomeVisitante(42)).toBeNull();
  });
});

describe("ehVisitanteId", () => {
  it("aceita só uuid", () => {
    expect(ehVisitanteId("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
    expect(ehVisitanteId("nao-e-uuid")).toBe(false);
    expect(ehVisitanteId("")).toBe(false);
    expect(ehVisitanteId(undefined)).toBe(false);
    expect(ehVisitanteId("0f8fad5b-d9cb-469f-a165-70867728950e; drop")).toBe(false);
  });
});

describe("limparTitulo", () => {
  it("vazio ou não-texto vira o padrão; corta espaços e limita a 100 caracteres", () => {
    expect(limparTitulo(undefined)).toBe("Reunião rápida");
    expect(limparTitulo("   ")).toBe("Reunião rápida");
    expect(limparTitulo(7)).toBe("Reunião rápida");
    expect(limparTitulo("  Alinhamento  ")).toBe("Alinhamento");
    expect(limparTitulo("x".repeat(150))).toHaveLength(100);
  });
});

describe("situacaoReuniao", () => {
  const agora = new Date("2026-10-22T20:00:00Z");
  it("ativa antes de expirar, vencida a partir de expira_em, encerrada quando tem encerrada_em", () => {
    expect(situacaoReuniao({ encerrada_em: null, expira_em: "2026-10-22T20:00:01Z" }, agora)).toBe("ativa");
    expect(situacaoReuniao({ encerrada_em: null, expira_em: "2026-10-22T20:00:00Z" }, agora)).toBe("vencida");
    expect(situacaoReuniao({ encerrada_em: "2026-10-22T19:00:00Z", expira_em: "2026-10-23T00:00:00Z" }, agora)).toBe("encerrada");
  });
  it("validade de 24 horas", () => {
    expect(VALIDADE_REUNIAO_MS).toBe(24 * 3600_000);
  });
});
