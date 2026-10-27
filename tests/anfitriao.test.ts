import { describe, expect, it } from "vitest";
import { rotuloAnfitriao } from "@/src/lib/regras/anfitriao";

const AGORA = new Date("2026-10-23T20:00:00Z");

describe("rotuloAnfitriao", () => {
  it("com anfitrião mostra o nome", () => {
    expect(rotuloAnfitriao({ nome: "Hugo", status: "encerrada", inicio: "2026-10-22T20:00:00Z", agora: AGORA })).toEqual({ texto: "Hugo", aviso: false });
  });
  it("sessão que já começou sem anfitrião: 'Sem anfitrião' em alerta", () => {
    expect(rotuloAnfitriao({ nome: null, status: "encerrada", inicio: "2026-10-22T20:00:00Z", agora: AGORA })).toEqual({ texto: "Sem anfitrião", aviso: true });
    expect(rotuloAnfitriao({ nome: null, status: "agendada", inicio: "2026-10-23T19:59:00Z", agora: AGORA })).toEqual({ texto: "Sem anfitrião", aviso: true });
  });
  it("futura sem anfitrião ou cancelada: travessão", () => {
    expect(rotuloAnfitriao({ nome: null, status: "agendada", inicio: "2026-10-23T21:00:00Z", agora: AGORA })).toEqual({ texto: "—", aviso: false });
    expect(rotuloAnfitriao({ nome: null, status: "cancelada", inicio: "2026-10-22T20:00:00Z", agora: AGORA })).toEqual({ texto: "—", aviso: false });
  });
});
