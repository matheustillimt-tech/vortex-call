import { describe, expect, it } from "vitest";
import { datasDaRepeticao } from "@/src/lib/regras/repeticao";

// Quinta, 22/10/2026, 10:00 em Brasília (13:00 UTC).
const agora = new Date("2026-10-22T13:00:00Z");

describe("datasDaRepeticao", () => {
  it("terça e quinta às 9h por 2 semanas, em UTC", () => {
    const d = datasDaRepeticao({ dias_semana: [2, 4], hora: "09:00", vagas: 30, ate: null }, agora, 2);
    expect(d.map((x) => x.toISOString())).toEqual([
      "2026-10-27T12:00:00.000Z", // ter 27
      "2026-10-29T12:00:00.000Z", // qui 29
      "2026-11-03T12:00:00.000Z", // ter 3
    ]);
  });
  it("não devolve horário que já passou hoje", () => {
    const d = datasDaRepeticao({ dias_semana: [4], hora: "09:00", vagas: 30, ate: null }, agora, 2);
    expect(d.map((x) => x.toISOString())).toEqual(["2026-10-29T12:00:00.000Z"]);
  });
  it("respeita a data final", () => {
    const d = datasDaRepeticao({ dias_semana: [2, 4], hora: "09:00", vagas: 30, ate: "2026-10-27" }, agora, 4);
    expect(d.map((x) => x.toISOString())).toEqual(["2026-10-27T12:00:00.000Z"]);
  });
});
