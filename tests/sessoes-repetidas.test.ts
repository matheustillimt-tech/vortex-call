import { describe, expect, it } from "vitest";
import { sessoesQueFaltam } from "@/src/lib/sessoes-repetidas";

const agora = new Date("2026-10-22T13:00:00Z");
const rep = { id: "r1", agenda_id: "a1", dias_semana: [2], hora: "09:00", vagas: 20, ate: null };

describe("sessoesQueFaltam", () => {
  it("cria 4 semanas de terças", () => {
    expect(sessoesQueFaltam(rep, [], agora).map((s) => s.inicio)).toEqual([
      "2026-10-27T12:00:00.000Z", "2026-11-03T12:00:00.000Z", "2026-11-10T12:00:00.000Z", "2026-11-17T12:00:00.000Z",
    ]);
  });
  it("não repete sessão que já existe e leva vagas e ids", () => {
    const faltam = sessoesQueFaltam(rep, ["2026-10-27T12:00:00.000Z", "2026-11-03T12:00:00+00:00"], agora);
    expect(faltam).toHaveLength(2);
    expect(faltam[0]).toEqual({ agenda_id: "a1", repeticao_id: "r1", inicio: "2026-11-10T12:00:00.000Z", vagas: 20 });
  });
});
