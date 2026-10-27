import { describe, expect, it } from "vitest";
import { montarScript } from "@/src/lib/regras/script-encaixe";

describe("montarScript", () => {
  const js = montarScript("https://call.exemplo.com.br");
  it("aponta para o site e para o modo encaixe", () => {
    expect(js).toContain('"https://call.exemplo.com.br"');
    expect(js).toContain("embed");
    expect(js).toContain("/agendar/");
  });
  it("ouve as duas mensagens do módulo e só da origem do Call", () => {
    expect(js).toContain("vortex-call:altura");
    expect(js).toContain("vortex-call:agendado");
    expect(js).toContain("e.origin !== SITE");
  });
  it("é JavaScript válido", () => {
    expect(() => new Function(js)).not.toThrow();
  });
});
