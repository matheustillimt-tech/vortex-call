import { describe, expect, it } from "vitest";
import { agruparPorFalante, juntarTrechos, lerLote, MAX_TRECHOS_POR_LOTE, paraTrecho, transcricaoEmTexto, type Trecho } from "@/src/lib/regras/transcricao";

const AGORA = new Date("2026-10-26T18:00:00.000Z");
const fala = (o: Record<string, unknown> = {}) => ({
  id: "t1", name: "Ana", peerId: "p1", userId: "u1", customParticipantId: "insc-1", transcript: "Quero automatizar o atendimento",
  isPartialTranscript: false, date: new Date("2026-10-26T17:59:00.000Z"), ...o,
});
const t = (id: string, em: string, nome = "Ana", customId: string | null = "insc-1", texto = "oi"): Trecho => ({ id, nome, customId, texto, em });

describe("paraTrecho", () => {
  it("fala final do SDK vira trecho; aceita date (Date ou texto) ou timestamp (ms)", () => {
    expect(paraTrecho(fala(), AGORA)).toEqual({ id: "t1", nome: "Ana", customId: "insc-1", texto: "Quero automatizar o atendimento", em: "2026-10-26T17:59:00.000Z" });
    expect(paraTrecho(fala({ date: "2026-10-26T17:59:00.000Z" }), AGORA)?.em).toBe("2026-10-26T17:59:00.000Z");
    expect(paraTrecho(fala({ date: undefined, timestamp: Date.parse("2026-10-26T17:58:00.000Z") }), AGORA)?.em).toBe("2026-10-26T17:58:00.000Z");
  });
  it("parcial, sem texto, sem id ou sem data = null", () => {
    expect(paraTrecho(fala({ isPartialTranscript: true }), AGORA)).toBeNull();
    expect(paraTrecho(fala({ transcript: "   " }), AGORA)).toBeNull();
    expect(paraTrecho(fala({ id: "" }), AGORA)).toBeNull();
    expect(paraTrecho(fala({ date: "lixo" }), AGORA)).toBeNull();
    expect(paraTrecho(null, AGORA)).toBeNull();
  });
  it("data longe de agora (mais de 12 h antes ou 5 min depois) = null", () => {
    expect(paraTrecho(fala({ date: new Date("2026-10-26T05:00:00.000Z") }), AGORA)).toBeNull();
    expect(paraTrecho(fala({ date: new Date("2026-10-26T18:10:00.000Z") }), AGORA)).toBeNull();
  });
  it("limpa espaços, corta textos longos e aceita o formato do lote (nome/texto/em/customId)", () => {
    const r = paraTrecho({ id: "x", nome: "  Bento  ", texto: "a\n\n b", em: "2026-10-26T17:59:00.000Z", customId: null }, AGORA);
    expect(r).toEqual({ id: "x", nome: "Bento", customId: null, texto: "a b", em: "2026-10-26T17:59:00.000Z" });
    expect(paraTrecho(fala({ transcript: "a".repeat(3000) }), AGORA)?.texto).toHaveLength(2000);
    expect(paraTrecho(fala({ name: "" }), AGORA)?.nome).toBe("Sem nome");
  });
});

describe("lerLote", () => {
  it("lista válida, sem repetir id, descartando o que não serve", () => {
    const r = lerLote({ trechos: [fala(), fala(), fala({ id: "t2", isPartialTranscript: true }), fala({ id: "t3" })] }, AGORA);
    expect(r.trechos?.map((x) => x.id)).toEqual(["t1", "t3"]);
  });
  it("sem lista ou acima do limite = erro", () => {
    expect(lerLote(null).erro).toBeTruthy();
    expect(lerLote({ trechos: "x" }).erro).toBeTruthy();
    expect(lerLote({ trechos: Array.from({ length: MAX_TRECHOS_POR_LOTE + 1 }, (_, i) => fala({ id: `t${i}` })) }, AGORA).erro).toBeTruthy();
  });
});

describe("juntar, agrupar e texto", () => {
  it("junta sem repetir id, em ordem de fala", () => {
    const r = juntarTrechos([t("b", "2026-10-26T17:02:00.000Z"), t("a", "2026-10-26T17:01:00.000Z")], [t("a", "2026-10-26T17:01:00.000Z"), t("c", "2026-10-26T17:03:00.000Z")]);
    expect(r.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("falas seguidas da mesma pessoa viram um bloco; outra pessoa abre outro", () => {
    const b = agruparPorFalante([
      t("1", "2026-10-26T17:01:00.000Z", "Ana", "insc-1", "Oi"),
      t("2", "2026-10-26T17:01:10.000Z", "Ana", "insc-1", "tudo bem?"),
      t("3", "2026-10-26T17:01:20.000Z", "Gabriel", "membro:g", "Tudo"),
      t("4", "2026-10-26T17:01:30.000Z", "Ana", "insc-1", "Bora"),
    ]);
    expect(b.map((x) => [x.nome, x.textos])).toEqual([["Ana", ["Oi", "tudo bem?"]], ["Gabriel", ["Tudo"]], ["Ana", ["Bora"]]]);
  });
  it("transcrição em texto com hora de Brasília", () => {
    expect(transcricaoEmTexto([t("1", "2026-10-26T18:02:00.000Z", "Ana", "insc-1", "Oi"), t("2", "2026-10-26T18:03:00.000Z", "Gabriel", "membro:g", "Olá")]))
      .toBe("[15:02] Ana: Oi\n[15:03] Gabriel: Olá");
  });
});

describe("lerTranscricaoCloudflare", () => {
  const BASE = new Date("2026-10-26T18:00:00.000Z");
  it("CSV com vírgula e aspas dentro do texto; tempo relativo ao início", async () => {
    const { lerTranscricaoCloudflare } = await import("@/src/lib/regras/transcricao");
    const r = lerTranscricaoCloudflare('"3000","p","u","insc-1","Ana","Oi, tudo ""bem""?"\n\n"x","p","u","c","B",""', BASE, "s");
    expect(r).toEqual([{ id: "cf:s:0", nome: "Ana", customId: "insc-1", texto: 'Oi, tudo "bem"?', em: "2026-10-26T18:00:03.000Z" }]);
  });
  it("JSON com startTime, sentence e peerData; epoch em ms também vale", async () => {
    const { lerTranscricaoCloudflare } = await import("@/src/lib/regras/transcricao");
    const r = lerTranscricaoCloudflare(JSON.stringify([
      { startTime: 2000, endTime: 3000, sentence: "Bom dia", peerData: { displayName: "Ana", customParticipantId: "insc-1" } },
      { startTime: Date.parse("2026-10-26T18:05:00.000Z"), sentence: "Fechado", peerData: { name: "Gabriel" } },
    ]), BASE, "s");
    expect(r.map((t) => [t.nome, t.texto, t.em])).toEqual([["Ana", "Bom dia", "2026-10-26T18:00:02.000Z"], ["Gabriel", "Fechado", "2026-10-26T18:05:00.000Z"]]);
    expect(lerTranscricaoCloudflare("{lixo", BASE, "s")).toEqual([]);
  });
});
