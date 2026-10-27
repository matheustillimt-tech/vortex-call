import { beforeEach, describe, expect, it, vi } from "vitest";

const tabelas: Record<string, Record<string, unknown> | null> = {};
const upsert = vi.fn(async (..._a: unknown[]) => ({ error: null }));
const from = vi.fn((tabela: string) => {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: tabelas[tabela] ?? null }),
    upsert: (...a: unknown[]) => upsert(tabela, ...a),
  };
  return q;
});
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from }) }));
const listarTrechos = vi.fn<(s: string) => Promise<unknown[]>>(async () => []);
vi.mock("@/src/lib/transcricao", () => ({ listarTrechos: (s: string) => listarTrechos(s) }));
let ia: { openrouterKey: string; modelo: string } | null = { openrouterKey: "k", modelo: "m" };
vi.mock("@/src/lib/env", () => ({ iaConfig: () => ia }));
const completarJson = vi.fn<(...a: unknown[]) => Promise<Record<string, unknown>>>();
vi.mock("@/src/lib/openrouter", () => ({ completarJson: (...a: unknown[]) => completarJson(...a) }));

const AGORA = new Date("2026-10-26T18:10:00.000Z");
const fala = (id: string, min: number, nome = "Ana", customId = "insc-1") => ({ id, nome, customId, texto: "fala", em: new Date(Date.parse("2026-10-26T18:00:00.000Z") + min * 60_000).toISOString() });
const RESPOSTA = { negocio: "Clínica", dor: "Perde lead", quer: "", combinado: ["Proposta sexta"], escopo: [], orcamento_prazo: "", objecoes: [], proximo_passo: "", temperatura: "morna", temperatura_motivo: "" };

beforeEach(() => {
  for (const k of Object.keys(tabelas)) delete tabelas[k];
  upsert.mockClear();
  listarTrechos.mockReset();
  completarJson.mockReset();
  ia = { openrouterKey: "k", modelo: "m" };
  tabelas.sessoes = { titulo: null, agendas: { nome: "Implementação" } };
});

describe("alinhamentoAoVivo", () => {
  it("sem fala: sem_fala; menos de 3 min: curto (sem chamar a IA)", async () => {
    const { alinhamentoAoVivo } = await import("@/src/lib/alinhamento");
    listarTrechos.mockResolvedValue([]);
    expect(await alinhamentoAoVivo("s1", AGORA)).toEqual({ estado: "sem_fala" });
    listarTrechos.mockResolvedValue([fala("1", 0), fala("2", 2)]);
    expect(await alinhamentoAoVivo("s1", AGORA)).toEqual({ estado: "curto" });
    expect(completarJson).not.toHaveBeenCalled();
  });

  it("com 3 min ou mais: chama a IA, guarda o ao_vivo e devolve pronto", async () => {
    listarTrechos.mockResolvedValue([fala("1", 0, "Gabriel", "membro:g"), fala("2", 1), fala("3", 4)]);
    completarJson.mockResolvedValue(RESPOSTA);
    const { alinhamentoAoVivo } = await import("@/src/lib/alinhamento");
    const r = await alinhamentoAoVivo("s1", AGORA);
    expect(r).toMatchObject({ estado: "pronto", gerado_em: AGORA.toISOString(), dados: { negocio: "Clínica", temperatura: "morna" } });
    const pedido = completarJson.mock.calls[0][0] as { usuario: string };
    expect(pedido.usuario).toContain("Agenda: Implementação.");
    expect(pedido.usuario).toContain("Equipe da empresa na call: Gabriel");
    expect(upsert).toHaveBeenCalledWith("alinhamentos", expect.objectContaining({ sessao_id: "s1", tipo: "ao_vivo", origem: "ao_vivo", total_trechos: 3, texto: expect.stringContaining("Negócio: Clínica") }), { onConflict: "sessao_id,tipo" });
  });

  it("último recente (menos de 90 s) ou sem fala nova: devolve o guardado, sem IA", async () => {
    const { alinhamentoAoVivo } = await import("@/src/lib/alinhamento");
    tabelas.alinhamentos = { dados: RESPOSTA, total_trechos: 3, gerado_em: new Date(AGORA.getTime() - 60_000).toISOString() };
    expect((await alinhamentoAoVivo("s1", AGORA)).estado).toBe("pronto");
    expect(listarTrechos).not.toHaveBeenCalled();
    tabelas.alinhamentos = { dados: RESPOSTA, total_trechos: 3, gerado_em: new Date(AGORA.getTime() - 300_000).toISOString() };
    listarTrechos.mockResolvedValue([fala("1", 0), fala("2", 1), fala("3", 4)]);
    expect((await alinhamentoAoVivo("s1", AGORA)).estado).toBe("pronto");
    expect(completarJson).not.toHaveBeenCalled();
  });

  it("IA falhou: devolve o anterior marcado falhou, ou falhou sem anterior; sem IA configurada: sem_ia", async () => {
    const { alinhamentoAoVivo } = await import("@/src/lib/alinhamento");
    listarTrechos.mockResolvedValue([fala("1", 0), fala("2", 1), fala("3", 4)]);
    completarJson.mockRejectedValue(new Error("A IA não respondeu."));
    expect(await alinhamentoAoVivo("s1", AGORA)).toEqual({ estado: "falhou" });
    completarJson.mockResolvedValue({});
    expect(await alinhamentoAoVivo("s1", AGORA)).toEqual({ estado: "falhou" });
    tabelas.alinhamentos = { dados: RESPOSTA, total_trechos: 2, gerado_em: "2026-10-26T18:00:00.000Z" };
    expect(await alinhamentoAoVivo("s1", AGORA)).toMatchObject({ estado: "pronto", falhou: true });
    delete tabelas.alinhamentos;
    ia = null;
    expect(await alinhamentoAoVivo("s1", AGORA)).toEqual({ estado: "sem_ia" });
    expect(upsert).not.toHaveBeenCalled();
  });
});
