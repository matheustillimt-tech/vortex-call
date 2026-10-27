import { describe, expect, it } from "vitest";
import { montarVitrine } from "@/src/lib/regras/vitrine";

const agora = new Date("2026-10-22T13:00:00Z");

describe("montarVitrine", () => {
  it("mostra vagas restantes, marca lotada e esconde passadas e canceladas", () => {
    const v = montarVitrine(
      [
        { id: "c", inicio: "2026-10-29T12:00:00Z", vagas: 10, inscritos: 10, status: "agendada" },
        { id: "a", inicio: "2026-10-23T12:00:00Z", vagas: 30, inscritos: 26, status: "agendada" },
        { id: "passada", inicio: "2026-10-22T12:00:00Z", vagas: 30, inscritos: 0, status: "agendada" },
        { id: "cancelada", inicio: "2026-10-24T12:00:00Z", vagas: 30, inscritos: 0, status: "cancelada" },
      ],
      agora,
      60,
    );
    expect(v).toEqual([
      { id: "a", inicio: "2026-10-23T12:00:00Z", restantes: 4, lotada: false },
      { id: "c", inicio: "2026-10-29T12:00:00Z", restantes: 0, lotada: true },
    ]);
  });
});
