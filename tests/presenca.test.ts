import { beforeEach, describe, expect, it, vi } from "vitest";

type Rec = Record<string, unknown>;

const INSC_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INSC_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INSC_OUTRA_SESSAO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let sessoes: Rec[];
let inscricoes: Rec[];
let presencas: Rec[];

function aplicarFiltros(lista: Rec[], filtros: [string, unknown][]): Rec[] {
  return lista.filter((l) => filtros.every(([col, val]) => (l[col] ?? null) === val));
}

/** Fake mínimo do PostgREST (supabase-js): só o que `presenca.ts` usa — `select().eq().maybeSingle()`,
 *  `upsert(v, { onConflict, ignoreDuplicates })` e `update(v).eq().is().select()`. */
function tabela(nome: string) {
  const lista = ({ sessoes, inscricoes, presencas } as Record<string, Rec[]>)[nome];
  return {
    select: () => {
      const filtros: [string, unknown][] = [];
      const q = {
        eq: (col: string, val: unknown) => {
          filtros.push([col, val]);
          return q;
        },
        maybeSingle: async () => ({ data: aplicarFiltros(lista, filtros)[0] ?? null, error: null }),
      };
      return q;
    },
    upsert: (valores: Rec, opts: { onConflict: string; ignoreDuplicates?: boolean }) => {
      const existente = lista.find((l) => l[opts.onConflict] === valores[opts.onConflict]);
      if (existente) {
        if (!opts.ignoreDuplicates) Object.assign(existente, valores);
      } else {
        lista.push({ ...valores });
      }
      return Promise.resolve({ error: null });
    },
    update: (valores: Rec) => {
      const filtros: [string, unknown][] = [];
      const q = {
        eq: (col: string, val: unknown) => {
          filtros.push([col, val]);
          return q;
        },
        is: (col: string, val: unknown) => {
          filtros.push([col, val]);
          return q;
        },
        select: async () => {
          const alvo = aplicarFiltros(lista, filtros);
          alvo.forEach((l) => Object.assign(l, valores));
          return { data: alvo.map((l) => ({ id: l.id })), error: null };
        },
      };
      return q;
    },
  };
}

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from: (t: string) => tabela(t) }) }));

beforeEach(() => {
  sessoes = [{ id: "sess-1", rtk_meeting_id: "meet-1" }];
  inscricoes = [
    { id: INSC_1, sessao_id: "sess-1" },
    { id: INSC_2, sessao_id: "sess-1" },
    { id: INSC_OUTRA_SESSAO, sessao_id: "sess-2" },
  ];
  presencas = [];
});

describe("registrarEntrada", () => {
  it("entrada de inscrito grava a presença", async () => {
    const { registrarEntrada } = await import("@/src/lib/presenca");
    await registrarEntrada({
      meeting: { id: "meet-1" },
      participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z" },
    });
    expect(presencas).toEqual([
      { sessao_id: "sess-1", inscricao_id: INSC_1, peer_id: "peer-1", entrou_em: "2026-10-23T10:00:00.000Z" },
    ]);
  });

  it("segunda entrada com outro peer grava outra linha (reconexão não funde, cada peer é dele)", async () => {
    const { registrarEntrada } = await import("@/src/lib/presenca");
    await registrarEntrada({
      meeting: { id: "meet-1" },
      participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z" },
    });
    await registrarEntrada({
      meeting: { id: "meet-1" },
      participant: { peerId: "peer-2", customParticipantId: INSC_2, joinedAt: "2026-10-23T10:05:00.000Z" },
    });
    expect(presencas).toHaveLength(2);
    expect(presencas.map((p) => p.peer_id)).toEqual(["peer-1", "peer-2"]);
  });

  it("mesmo peer de novo (reconexão) não duplica: on conflict (peer_id) do nothing", async () => {
    const { registrarEntrada } = await import("@/src/lib/presenca");
    const entrada = {
      meeting: { id: "meet-1" },
      participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z" },
    };
    await registrarEntrada(entrada);
    await registrarEntrada(entrada);
    expect(presencas).toHaveLength(1);
  });

  it("campos na raiz do payload (sem o objeto participant) também funcionam", async () => {
    const { registrarEntrada } = await import("@/src/lib/presenca");
    await registrarEntrada({
      meeting: { id: "meet-1" },
      peerId: "peer-1",
      customParticipantId: INSC_1,
      joinedAt: "2026-10-23T10:00:00.000Z",
    });
    expect(presencas).toEqual([
      { sessao_id: "sess-1", inscricao_id: INSC_1, peer_id: "peer-1", entrou_em: "2026-10-23T10:00:00.000Z" },
    ]);
  });

  it("equipe (membro:) é ignorada, sem gravar presença", async () => {
    const { registrarEntrada } = await import("@/src/lib/presenca");
    await registrarEntrada({
      meeting: { id: "meet-1" },
      participant: { peerId: "peer-1", customParticipantId: "membro:abc", joinedAt: "2026-10-23T10:00:00.000Z" },
    });
    expect(presencas).toEqual([]);
  });

  it("visitante (visitante:) é ignorado, sem gravar presença", async () => {
    const { registrarEntrada } = await import("@/src/lib/presenca");
    await registrarEntrada({
      meeting: { id: "meet-1" },
      participant: { peerId: "peer-1", customParticipantId: "visitante:abc123", joinedAt: "2026-10-23T10:00:00.000Z" },
    });
    expect(presencas).toEqual([]);
  });

  it("inscrição de outra sessão (uuid válido, mas não é dessa sessão) é ignorada", async () => {
    const { registrarEntrada } = await import("@/src/lib/presenca");
    await registrarEntrada({
      meeting: { id: "meet-1" },
      participant: { peerId: "peer-1", customParticipantId: INSC_OUTRA_SESSAO, joinedAt: "2026-10-23T10:00:00.000Z" },
    });
    expect(presencas).toEqual([]);
  });

  it("meeting sem sessão (reunião instantânea) é ignorada", async () => {
    const { registrarEntrada } = await import("@/src/lib/presenca");
    await registrarEntrada({
      meeting: { id: "meet-fantasma" },
      participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z" },
    });
    expect(presencas).toEqual([]);
  });

  it("resolve o id da meeting com o mesmo fallback do meeting.ended: meetingId na raiz", async () => {
    const { registrarEntrada } = await import("@/src/lib/presenca");
    await registrarEntrada({
      meetingId: "meet-1",
      participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z" },
    });
    expect(presencas).toHaveLength(1);
  });

  it("resolve o id da meeting com o mesmo fallback do meeting.ended: meeting.meetingId", async () => {
    const { registrarEntrada } = await import("@/src/lib/presenca");
    await registrarEntrada({
      meeting: { meetingId: "meet-1" },
      participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z" },
    });
    expect(presencas).toHaveLength(1);
  });

  it("sem nenhum id de meeting reconhecível: loga e sai sem lançar", async () => {
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    const { registrarEntrada } = await import("@/src/lib/presenca");
    await expect(
      registrarEntrada({
        event: "meeting.participantJoined",
        participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z" },
      }),
    ).resolves.toBeUndefined();
    expect(presencas).toEqual([]);
    expect(espiao).toHaveBeenCalledWith("[webhook rtk] presença sem id da meeting", expect.arrayContaining(["event", "participant"]));
    espiao.mockRestore();
  });

  it("participantJoined atrasado depois do participantLeft já ter fechado o peer não reabre (on conflict do nothing)", async () => {
    presencas = [
      { id: "p1", sessao_id: "sess-1", inscricao_id: INSC_1, peer_id: "peer-1", entrou_em: "2026-10-23T10:00:00.000Z", saiu_em: "2026-10-23T10:30:00.000Z" },
    ];
    const { registrarEntrada } = await import("@/src/lib/presenca");
    await registrarEntrada({
      meeting: { id: "meet-1" },
      participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z" },
    });
    expect(presencas).toHaveLength(1);
    expect(presencas[0].saiu_em).toBe("2026-10-23T10:30:00.000Z");
  });

  it("formato estranho (sem peerId/customParticipantId) não lança, só loga e sai", async () => {
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    const { registrarEntrada } = await import("@/src/lib/presenca");
    await expect(registrarEntrada({ event: "meeting.participantJoined" })).resolves.toBeUndefined();
    expect(presencas).toEqual([]);
    expect(espiao).toHaveBeenCalledWith(
      "[webhook rtk] presença sem peerId/customParticipantId",
      expect.arrayContaining(["event"]),
    );
    espiao.mockRestore();
  });
});

describe("registrarSaida", () => {
  it("saída fecha a presença aberta pelo peerId", async () => {
    presencas = [{ id: "p1", sessao_id: "sess-1", inscricao_id: INSC_1, peer_id: "peer-1", entrou_em: "2026-10-23T10:00:00.000Z", saiu_em: null }];
    const { registrarSaida } = await import("@/src/lib/presenca");
    await registrarSaida({
      meeting: { id: "meet-1" },
      participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z", leftAt: "2026-10-23T10:30:00.000Z" },
    });
    expect(presencas[0].saiu_em).toBe("2026-10-23T10:30:00.000Z");
  });

  it("campos na raiz do payload também funcionam pra saída", async () => {
    presencas = [{ id: "p1", sessao_id: "sess-1", inscricao_id: INSC_1, peer_id: "peer-1", entrou_em: "2026-10-23T10:00:00.000Z", saiu_em: null }];
    const { registrarSaida } = await import("@/src/lib/presenca");
    await registrarSaida({ meeting: { id: "meet-1" }, peerId: "peer-1", leftAt: "2026-10-23T10:30:00.000Z" });
    expect(presencas[0].saiu_em).toBe("2026-10-23T10:30:00.000Z");
  });

  it("join perdido (nenhuma presença aberta com esse peer): insere já fechada, se a inscrição for válida", async () => {
    const { registrarSaida } = await import("@/src/lib/presenca");
    await registrarSaida({
      meeting: { id: "meet-1" },
      participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z", leftAt: "2026-10-23T10:30:00.000Z" },
    });
    expect(presencas).toEqual([
      {
        sessao_id: "sess-1",
        inscricao_id: INSC_1,
        peer_id: "peer-1",
        entrou_em: "2026-10-23T10:00:00.000Z",
        saiu_em: "2026-10-23T10:30:00.000Z",
      },
    ]);
  });

  it("join perdido: resolve o id da meeting com o fallback (meetingId na raiz)", async () => {
    const { registrarSaida } = await import("@/src/lib/presenca");
    await registrarSaida({
      meetingId: "meet-1",
      participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z", leftAt: "2026-10-23T10:30:00.000Z" },
    });
    expect(presencas).toHaveLength(1);
  });

  it("join perdido sem nenhum id de meeting reconhecível: loga e sai sem lançar", async () => {
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    const { registrarSaida } = await import("@/src/lib/presenca");
    await expect(
      registrarSaida({
        event: "meeting.participantLeft",
        participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z", leftAt: "2026-10-23T10:30:00.000Z" },
      }),
    ).resolves.toBeUndefined();
    expect(presencas).toEqual([]);
    expect(espiao).toHaveBeenCalledWith("[webhook rtk] presença sem id da meeting", expect.arrayContaining(["event", "participant"]));
    espiao.mockRestore();
  });

  it("join perdido de equipe/visitante não insere nada", async () => {
    const { registrarSaida } = await import("@/src/lib/presenca");
    await registrarSaida({
      meeting: { id: "meet-1" },
      participant: { peerId: "peer-1", customParticipantId: "membro:abc", joinedAt: "2026-10-23T10:00:00.000Z", leftAt: "2026-10-23T10:30:00.000Z" },
    });
    expect(presencas).toEqual([]);
  });

  it("formato estranho (sem peerId/leftAt) não lança, só loga e sai", async () => {
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    const { registrarSaida } = await import("@/src/lib/presenca");
    await expect(registrarSaida({ event: "meeting.participantLeft" })).resolves.toBeUndefined();
    expect(presencas).toEqual([]);
    expect(espiao).toHaveBeenCalledWith(
      "[webhook rtk] presença sem peerId/customParticipantId",
      expect.arrayContaining(["event"]),
    );
    espiao.mockRestore();
  });
});
