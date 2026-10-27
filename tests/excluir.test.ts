import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";

const fecharMeeting = vi.fn(async (_meetingId: string) => {});
const apagar = vi.fn(async (_chave: string) => {});
vi.mock("@/src/lib/participantes", () => ({ fecharMeeting: (meetingId: string) => fecharMeeting(meetingId) }));
vi.mock("@/src/lib/r2", () => ({ apagar: (chave: string) => apagar(chave) }));

import { contarDependencias, dependenciasDasReunioes, excluirAgenda, excluirGravacao, excluirReuniao, excluirSessao } from "@/src/lib/api/excluir";

const A1 = "11111111-1111-4111-8111-111111111111";

let f: ReturnType<typeof criarDbFalso>;

beforeEach(() => {
  fecharMeeting.mockClear();
  apagar.mockClear();
  f = criarDbFalso({});
});

describe("contarDependencias", () => {
  it("chama a rpc com o tipo e o id, e devolve o jsonb", async () => {
    const rpc = vi.fn(async () => ({ data: { sessoes: 2, inscritos: 12, gravacoes: 1, avisos: 30, vendas: 2 }, error: null }));
    const db = { rpc } as unknown as Parameters<typeof contarDependencias>[0];
    const r = await contarDependencias(db, "agenda", A1);
    expect(rpc).toHaveBeenCalledWith("contar_dependencias", { p_tipo: "agenda", p_id: A1 });
    expect(r).toEqual({ sessoes: 2, inscritos: 12, gravacoes: 1, avisos: 30, vendas: 2 });
  });

  it("erro do banco vira erro de tela", async () => {
    const db = { rpc: vi.fn(async () => ({ data: null, error: { message: "falha" } })) } as unknown as Parameters<typeof contarDependencias>[0];
    await expect(contarDependencias(db, "sessao", A1)).rejects.toThrow("Não deu para contar o que está ligado.");
  });
});

describe("dependenciasDasReunioes", () => {
  it("uma consulta só pras gravações de todas as reuniões; sem gravação fica com zero", async () => {
    f = criarDbFalso({
      gravacoes: [
        { id: "g1", reuniao_id: "r1" },
        { id: "g2", reuniao_id: "r1" },
        { id: "g3", reuniao_id: "r3" },
        { id: "g4", reuniao_id: null, sessao_id: "s1" },
      ],
    });
    const r = await dependenciasDasReunioes(f.db, ["r1", "r2"]);
    expect(r.get("r1")).toEqual({ sessoes: 0, inscritos: 0, gravacoes: 2, avisos: 0, vendas: 0 });
    expect(r.get("r2")).toEqual({ sessoes: 0, inscritos: 0, gravacoes: 0, avisos: 0, vendas: 0 });
    expect(r.has("r3")).toBe(false);
  });

  it("lista vazia não consulta", async () => {
    const db = { from: vi.fn() } as unknown as Parameters<typeof dependenciasDasReunioes>[0];
    expect((await dependenciasDasReunioes(db, [])).size).toBe(0);
    expect((db as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });

  it("erro do banco vira erro de tela", async () => {
    f = criarDbFalso({ gravacoes: [] });
    f.falhar("gravacoes", "select");
    await expect(dependenciasDasReunioes(f.db, ["r1"])).rejects.toThrow("Não deu para contar o que está ligado.");
  });
});

describe("excluirGravacao", () => {
  beforeEach(() => {
    f = criarDbFalso({ gravacoes: [{ id: "g1", sessao_id: null, reuniao_id: null, r2_chave: "gravacoes/s_abc_1" }] });
  });

  it("lê a r2_chave, apaga a linha e depois o arquivo no R2", async () => {
    await excluirGravacao(f.db, "g1");
    expect(f.tabelas.gravacoes).toHaveLength(0);
    expect(apagar).toHaveBeenCalledWith("gravacoes/s_abc_1");
  });

  it("sem r2_chave não chama o R2", async () => {
    f = criarDbFalso({ gravacoes: [{ id: "g1", r2_chave: null }] });
    await excluirGravacao(f.db, "g1");
    expect(apagar).not.toHaveBeenCalled();
  });

  it("falha ao apagar no R2 é logada e não impede (a linha já foi apagada)", async () => {
    apagar.mockRejectedValueOnce(new Error("R2 fora do ar"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(excluirGravacao(f.db, "g1")).resolves.toBeUndefined();
    expect(f.tabelas.gravacoes).toHaveLength(0);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("gravação inexistente: nada acontece", async () => {
    await expect(excluirGravacao(f.db, "nao-existe")).resolves.toBeUndefined();
    expect(apagar).not.toHaveBeenCalled();
  });
});

describe("excluirSessao", () => {
  it("sessão ao_vivo com meeting desliga a sala antes de apagar", async () => {
    f = criarDbFalso({ sessoes: [{ id: "s1", agenda_id: A1, status: "ao_vivo", rtk_meeting_id: "m1" }] });
    await excluirSessao(f.db, "s1");
    expect(fecharMeeting).toHaveBeenCalledWith("m1");
    expect(f.tabelas.sessoes).toHaveLength(0);
  });

  it("sessão agendada não desliga sala nenhuma", async () => {
    f = criarDbFalso({ sessoes: [{ id: "s1", agenda_id: A1, status: "agendada", rtk_meeting_id: "m1" }] });
    await excluirSessao(f.db, "s1");
    expect(fecharMeeting).not.toHaveBeenCalled();
  });

  it("lê as r2_chave das gravações da sessão antes de apagar a sessão (ordem das chamadas no banco)", async () => {
    f = criarDbFalso({
      sessoes: [{ id: "s1", agenda_id: A1, status: "agendada", rtk_meeting_id: null }],
      gravacoes: [{ id: "g1", sessao_id: "s1", r2_chave: "gravacoes/s_s1_1" }],
    });
    await excluirSessao(f.db, "s1");
    const posGravacoes = f.chamadas.findIndex((c) => c.tabela === "gravacoes" && c.op === "select");
    const posDeleteSessao = f.chamadas.findIndex((c) => c.tabela === "sessoes" && c.op === "delete");
    expect(posGravacoes).toBeGreaterThanOrEqual(0);
    expect(posDeleteSessao).toBeGreaterThan(posGravacoes);
    expect(apagar).toHaveBeenCalledWith("gravacoes/s_s1_1");
  });

  it("limpa os passes_rtk da meeting depois de apagar", async () => {
    f = criarDbFalso({
      sessoes: [{ id: "s1", agenda_id: A1, status: "agendada", rtk_meeting_id: "m1" }],
      passes_rtk: [{ custom_id: "c1", meeting_id: "m1" }, { custom_id: "c2", meeting_id: "m2" }],
    });
    await excluirSessao(f.db, "s1");
    expect(f.tabelas.passes_rtk).toEqual([{ custom_id: "c2", meeting_id: "m2" }]);
  });

  it("sessão inexistente: nada acontece", async () => {
    await expect(excluirSessao(f.db, "nao-existe")).resolves.toBeUndefined();
    expect(fecharMeeting).not.toHaveBeenCalled();
  });
});

describe("excluirReuniao", () => {
  it("reunião não encerrada com meeting desliga a sala antes de apagar", async () => {
    f = criarDbFalso({ reunioes: [{ id: "r1", encerrada_em: null, rtk_meeting_id: "m1" }] });
    await excluirReuniao(f.db, "r1");
    expect(fecharMeeting).toHaveBeenCalledWith("m1");
    expect(f.tabelas.reunioes).toHaveLength(0);
  });

  it("reunião já encerrada não desliga sala nenhuma", async () => {
    f = criarDbFalso({ reunioes: [{ id: "r1", encerrada_em: "2026-01-01T00:00:00Z", rtk_meeting_id: "m1" }] });
    await excluirReuniao(f.db, "r1");
    expect(fecharMeeting).not.toHaveBeenCalled();
  });

  it("apaga o arquivo das gravações da reunião no R2", async () => {
    f = criarDbFalso({
      reunioes: [{ id: "r1", encerrada_em: "2026-01-01T00:00:00Z", rtk_meeting_id: null }],
      gravacoes: [{ id: "g1", reuniao_id: "r1", r2_chave: "gravacoes/r_r1_1" }],
    });
    await excluirReuniao(f.db, "r1");
    expect(apagar).toHaveBeenCalledWith("gravacoes/r_r1_1");
  });
});

describe("excluirAgenda", () => {
  it("desliga só as sessões ao_vivo, apaga a agenda e limpa os passes de todas as meetings afetadas", async () => {
    f = criarDbFalso({
      agendas: [{ id: A1, nome: "Diagnóstico" }],
      sessoes: [
        { id: "s1", agenda_id: A1, status: "ao_vivo", rtk_meeting_id: "m1" },
        { id: "s2", agenda_id: A1, status: "agendada", rtk_meeting_id: "m2" },
        { id: "s3", agenda_id: A1, status: "encerrada", rtk_meeting_id: null },
      ],
      gravacoes: [
        { id: "g1", sessao_id: "s1", r2_chave: "gravacoes/s_s1_1" },
        { id: "g2", sessao_id: "s2", r2_chave: "gravacoes/s_s2_1" },
        { id: "g3", sessao_id: "outra", r2_chave: "gravacoes/s_outra_1" },
      ],
      passes_rtk: [{ custom_id: "c1", meeting_id: "m1" }, { custom_id: "c2", meeting_id: "m2" }, { custom_id: "c3", meeting_id: "m3" }],
    });
    await excluirAgenda(f.db, A1);
    expect(fecharMeeting).toHaveBeenCalledOnce();
    expect(fecharMeeting).toHaveBeenCalledWith("m1");
    expect(f.tabelas.agendas).toHaveLength(0);
    expect(f.tabelas.passes_rtk).toEqual([{ custom_id: "c3", meeting_id: "m3" }]);
    expect(apagar).toHaveBeenCalledWith("gravacoes/s_s1_1");
    expect(apagar).toHaveBeenCalledWith("gravacoes/s_s2_1");
    expect(apagar).not.toHaveBeenCalledWith("gravacoes/s_outra_1");
  });

  it("agenda sem sessão nenhuma: não chama o R2 nem a sala", async () => {
    f = criarDbFalso({ agendas: [{ id: A1, nome: "Vazia" }] });
    await excluirAgenda(f.db, A1);
    expect(fecharMeeting).not.toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(f.tabelas.agendas).toHaveLength(0);
  });
});
