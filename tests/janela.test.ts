import { describe, expect, it } from "vitest";
import { filtrarJanela, sessaoNaJanela } from "@/src/lib/regras/janela";

type S = { id: string; inicio: string; vagas: number; inscritos: number; status: string };
const s = (id: string, inicio: string, extra: Partial<S> = {}): S => ({ id, inicio, vagas: 10, inscritos: 0, status: "agendada", ...extra });
const ids = (l: { id: string }[]) => l.map((x) => x.id);

// Semana de 23/10/2026 (sexta) a 28/10/2026 (quarta). Horários em Brasília (UTC-3).
const sessoes = [
  s("sex-10", "2026-10-23T13:00:00Z"), // sexta 10h
  s("sex-16", "2026-10-23T19:00:00Z"), // sexta 16h
  s("seg-10", "2026-10-26T13:00:00Z"), // segunda 10h
  s("seg-16", "2026-10-26T19:00:00Z"), // segunda 16h
  s("ter-10", "2026-10-27T13:00:00Z"), // terça 10h
  s("qua-10", "2026-10-28T13:00:00Z"), // quarta 10h
];

describe("filtrarJanela", () => {
  it("sem limite (null) devolve tudo como veio", () => {
    expect(filtrarJanela(sessoes, null, new Date("2026-10-23T18:00:00Z"))).toEqual(sessoes);
  });

  it("N=2 na sexta 15h: o que resta de sexta + segunda", () => {
    expect(ids(filtrarJanela(sessoes, 2, new Date("2026-10-23T18:00:00Z")))).toEqual(["sex-16", "seg-10", "seg-16"]);
  });

  it("N=2 no sábado: segunda + terça (fim de semana sem horário não conta)", () => {
    expect(ids(filtrarJanela(sessoes, 2, new Date("2026-10-24T15:00:00Z")))).toEqual(["seg-10", "seg-16", "ter-10"]);
  });

  it("N=2 na segunda 20h (nada mais hoje): terça + quarta", () => {
    expect(ids(filtrarJanela(sessoes, 2, new Date("2026-10-26T23:00:00Z")))).toEqual(["ter-10", "qua-10"]);
  });

  it("N=1: só o primeiro dia com horário", () => {
    expect(ids(filtrarJanela(sessoes, 1, new Date("2026-10-23T12:00:00Z")))).toEqual(["sex-10", "sex-16"]);
  });

  it("dia é o de Brasília: 23h de sexta (02h UTC de sábado) continua sendo sexta", () => {
    const tarde = [s("sex-23", "2026-10-24T02:00:00Z"), s("seg-10", "2026-10-26T13:00:00Z"), s("ter-10", "2026-10-27T13:00:00Z")];
    expect(ids(filtrarJanela(tarde, 1, new Date("2026-10-23T22:00:00Z")))).toEqual(["sex-23"]);
    expect(ids(filtrarJanela(tarde, 2, new Date("2026-10-23T22:00:00Z")))).toEqual(["sex-23", "seg-10"]);
  });

  it("dia só com sessão lotada não conta, mas lotada de dia que conta continua aparecendo", () => {
    const l = [
      s("sex-lotada", "2026-10-23T19:00:00Z", { inscritos: 10 }),
      s("seg-lotada", "2026-10-26T13:00:00Z", { inscritos: 10 }),
      s("seg-livre", "2026-10-26T19:00:00Z"),
      s("ter-10", "2026-10-27T13:00:00Z"),
      s("qua-10", "2026-10-28T13:00:00Z"),
    ];
    expect(ids(filtrarJanela(l, 2, new Date("2026-10-23T12:00:00Z")))).toEqual(["seg-lotada", "seg-livre", "ter-10"]);
  });

  it("passada e cancelada não contam nem aparecem", () => {
    const l = [
      s("sex-passada", "2026-10-23T13:00:00Z"),
      s("sex-cancelada", "2026-10-23T20:00:00Z", { status: "cancelada" }),
      s("seg-10", "2026-10-26T13:00:00Z"),
      s("ter-10", "2026-10-27T13:00:00Z"),
    ];
    expect(ids(filtrarJanela(l, 1, new Date("2026-10-23T18:00:00Z")))).toEqual(["seg-10"]);
  });

  it("aceita lista fora de ordem e devolve na mesma ordem em que veio", () => {
    const l = [sessoes[3], sessoes[0], sessoes[4], sessoes[2]];
    expect(ids(filtrarJanela(l, 1, new Date("2026-10-24T15:00:00Z")))).toEqual(["seg-16", "seg-10"]);
  });

  it("menos dias com horário que N: mostra todos", () => {
    expect(ids(filtrarJanela(sessoes, 30, new Date("2026-10-26T23:00:00Z")))).toEqual(["ter-10", "qua-10"]);
  });

  it("sem sessão nenhuma: lista vazia", () => {
    expect(filtrarJanela([], 2, new Date())).toEqual([]);
  });
});

describe("sessaoNaJanela", () => {
  const agora = new Date("2026-10-24T15:00:00Z"); // sábado
  it("aceita sessão de dia aberto e recusa a de depois", () => {
    expect(sessaoNaJanela(sessoes, "seg-10", 2, agora)).toBe(true);
    expect(sessaoNaJanela(sessoes, "ter-10", 2, agora)).toBe(true);
    expect(sessaoNaJanela(sessoes, "qua-10", 2, agora)).toBe(false);
  });
  it("sem limite: sempre aceita (quem decide é a função inscrever)", () => {
    expect(sessaoNaJanela(sessoes, "qua-10", null, agora)).toBe(true);
    expect(sessaoNaJanela([], "qualquer", null, agora)).toBe(true);
  });
  it("sessão fora da lista com limite: recusa", () => {
    expect(sessaoNaJanela(sessoes, "nao-existe", 2, agora)).toBe(false);
  });
});
