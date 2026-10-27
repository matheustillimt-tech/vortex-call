import { describe, expect, it } from "vitest";
import { lerPrefill } from "@/src/lib/regras/encaixe";

describe("lerPrefill", () => {
  it("lê dados do lead, UTMs e o modo encaixe", () => {
    expect(
      lerPrefill({ nome: "Maria", whatsapp: "1137654321", email: "m@x.com", r: "resp_1", utm_source: "ig", embed: "1", outro: "x" }),
    ).toEqual({ nome: "Maria", whatsapp: "1137654321", email: "m@x.com", resposta: "resp_1", utm: { utm_source: "ig" }, embed: true });
  });
  it("sem nada vira vazio e fora do encaixe", () => {
    expect(lerPrefill({})).toEqual({ nome: "", whatsapp: "", email: "", resposta: "", utm: {}, embed: false });
  });
  it("valor repetido pega o primeiro e corta texto longo", () => {
    expect(lerPrefill({ nome: ["A", "B"], email: "x".repeat(500) })).toMatchObject({ nome: "A", email: "x".repeat(200) });
  });
  it("array vazio não estoura (vira vazio)", () => {
    expect(lerPrefill({ nome: [] })).toMatchObject({ nome: "" });
  });
});
