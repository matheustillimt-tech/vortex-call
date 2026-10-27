import { describe, expect, it } from "vitest";
import { estadoDaSala } from "@/src/lib/regras/estado-sala";

const inicio = new Date("2026-10-27T12:00:00Z");
const base = { inscricao: "agendado", sessao: "agendada", inicio, duracaoMin: 60, abreAntesMin: 5 };
const em = (iso: string) => ({ ...base, agora: new Date(iso) });

describe("estadoDaSala", () => {
  it("antes da janela espera", () => expect(estadoDaSala(em("2026-10-27T11:54:00Z")).estado).toBe("espera"));
  it("na janela, sem anfitrião, aguarda", () => expect(estadoDaSala(em("2026-10-27T11:56:00Z")).estado).toBe("aguardando_anfitriao"));
  it("anfitrião abriu: aberta", () => expect(estadoDaSala({ ...em("2026-10-27T12:01:00Z"), sessao: "ao_vivo" }).estado).toBe("aberta"));
  it("anfitrião abriu cedo: aberta mesmo antes da janela", () => expect(estadoDaSala({ ...em("2026-10-27T11:30:00Z"), sessao: "ao_vivo" }).estado).toBe("aberta"));
  it("passou de início + duração + 2 h: acabou", () => expect(estadoDaSala(em("2026-10-27T15:00:00Z")).estado).toBe("acabou"));
  it("sessão encerrada: acabou", () => expect(estadoDaSala({ ...em("2026-10-27T12:10:00Z"), sessao: "encerrada" }).estado).toBe("acabou"));
  it("inscrição cancelada vence tudo", () => expect(estadoDaSala({ ...em("2026-10-27T12:10:00Z"), inscricao: "cancelado", sessao: "ao_vivo" }).estado).toBe("cancelada"));
  it("devolve abreEm e fechaEm", () => {
    const r = estadoDaSala(em("2026-10-27T10:00:00Z"));
    expect(r.abreEm.toISOString()).toBe("2026-10-27T11:55:00.000Z");
    expect(r.fechaEm.toISOString()).toBe("2026-10-27T15:00:00.000Z");
  });
});
