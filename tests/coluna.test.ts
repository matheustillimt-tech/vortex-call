import { describe, expect, it } from "vitest";
import { abaAtual, iniciais, inscricaoDoCustomId, juntarUserIds, mensagensDaPessoa, separarPessoas } from "@/src/lib/regras/coluna";

const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("separarPessoas", () => {
  it("convidado por uuid, equipe por membro:, ignora o resto; em ordem de nome", () => {
    expect(
      separarPessoas([
        { id: "p1", userId: "u1", nome: "Zeca", customId: U1 },
        { id: "p2", userId: "u2", nome: "Gus", customId: "membro:m1" },
        { id: "p3", userId: "u3", nome: "Gravador", customId: null },
        { id: "p4", userId: "u4", nome: "Ana", customId: U2.toUpperCase() },
        { id: "p5", userId: "u5", nome: "Outro", customId: "qualquer" },
      ]),
    ).toEqual({
      convidados: [
        { inscricaoId: U2, nome: "Ana", userId: "u4" },
        { inscricaoId: U1, nome: "Zeca", userId: "u1" },
      ],
      equipe: ["Gus"],
      externos: [],
    });
  });

  it("mesma inscrição duas vezes (reconexão): uma só, a última", () => {
    const r = separarPessoas([
      { id: "p1", userId: "u1", nome: "Ana", customId: U1 },
      { id: "p2", userId: "u9", nome: "Ana", customId: U1 },
    ]);
    expect(r.convidados).toEqual([{ inscricaoId: U1, nome: "Ana", userId: "u9" }]);
  });
});

describe("abaAtual", () => {
  it("sem escolha: roteiro sem convidado, pessoas com convidado", () => {
    expect(abaAtual(null, 0)).toBe("roteiro");
    expect(abaAtual(null, 2)).toBe("pessoas");
  });
  it("escolha manda", () => {
    expect(abaAtual("roteiro", 3)).toBe("roteiro");
    expect(abaAtual("pessoas", 0)).toBe("pessoas");
  });
});

describe("iniciais", () => {
  it("primeira e última palavra", () => {
    expect(iniciais("ana maria souza")).toBe("AS");
    expect(iniciais("Ana")).toBe("A");
    expect(iniciais("  ")).toBe("?");
  });
});

describe("juntarUserIds", () => {
  it("acumula userIds por inscrição e devolve o mesmo objeto se nada mudou", () => {
    const a = juntarUserIds({}, [{ inscricaoId: U1, nome: "Ana", userId: "u1" }]);
    expect(a).toEqual({ [U1]: ["u1"] });
    const b = juntarUserIds(a, [{ inscricaoId: U1, nome: "Ana", userId: "u2" }]);
    expect(b).toEqual({ [U1]: ["u1", "u2"] });
    expect(juntarUserIds(b, [{ inscricaoId: U1, nome: "Ana", userId: "u2" }])).toBe(b);
  });
});

describe("mensagensDaPessoa", () => {
  const t = new Date("2026-10-22T15:04:00Z");
  const msgs = [
    { id: "1", userId: "u1", time: t, type: "text", message: " Oi, tudo bem? " },
    { id: "2", userId: "u2", time: t, type: "text", message: "de outro" },
    { id: "3", userId: "u1", time: t, type: "image" },
    { id: "4", userId: "u9", time: t, type: "file" },
    { id: "5", userId: "u1", time: t, type: "text", message: "só pra você", targetUserIds: ["eu"] },
    { id: "6", userId: "u1", time: t, type: "custom", message: "   " },
  ];
  it("só as da pessoa (todos os userIds dela), com hora de Brasília", () => {
    expect(mensagensDaPessoa(msgs, ["u1", "u9"])).toEqual([
      { id: "1", hora: "12:04", texto: "Oi, tudo bem?", privada: false },
      { id: "3", hora: "12:04", texto: "[imagem]", privada: false },
      { id: "4", hora: "12:04", texto: "[arquivo]", privada: false },
      { id: "5", hora: "12:04", texto: "só pra você", privada: true },
    ]);
  });
  it("sem userId conhecido: nada", () => {
    expect(mensagensDaPessoa(msgs, [])).toEqual([]);
  });
});

describe("inscricaoDoCustomId (nome no palco abre a ficha)", () => {
  it("lead: uuid da inscrição em minúsculas", () => {
    expect(inscricaoDoCustomId(U1)).toBe(U1);
    expect(inscricaoDoCustomId(U2.toUpperCase())).toBe(U2);
  });

  it("equipe, convidado de fora, visitante, gravador e vazio não têm ficha", () => {
    for (const id of ["membro:m1", "convidado:abc", "visitante:abc", "gravador", "", null, undefined]) {
      expect(inscricaoDoCustomId(id)).toBeNull();
    }
  });
});
