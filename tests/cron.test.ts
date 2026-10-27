import { beforeEach, describe, expect, it, vi } from "vitest";

const enfileirarLembretes = vi.fn(async () => 6);
const avaliarSessoes = vi.fn(async () => 1);
const entregarPendentes = vi.fn(async (..._a: unknown[]) => ({ enviados: 7, falhas: 2 }));
const gerarSessoesRepetidas = vi.fn(async () => 3);

vi.mock("@/src/lib/sessoes-repetidas", () => ({ gerarSessoesRepetidas: () => gerarSessoesRepetidas() }));
vi.mock("@/src/lib/limite", () => ({ limparLimites: vi.fn(async () => 5) }));
vi.mock("@/src/lib/transcricao", () => ({ limparTranscricoesVelhas: vi.fn(async () => 7) }));
vi.mock("@/src/lib/sala", () => ({ fecharSessoesVencidas: vi.fn(async () => 2) }));
vi.mock("@/src/lib/reunioes", () => ({ fecharReunioesVencidas: vi.fn(async () => 4) }));
vi.mock("@/src/lib/disparos", () => ({ enfileirarLembretes: () => enfileirarLembretes(), enfileirarComecouNaHora: async () => 0, avaliarSessoes: () => avaliarSessoes() }));
vi.mock("@/src/lib/eventos", () => ({ entregarPendentes: (...a: unknown[]) => entregarPendentes(...a) }));
const entregarAvisosEquipe = vi.fn(async (..._a: unknown[]) => ({ enviados: 1, falhas: 0 }));
const enfileirarAvisosEmBreve = vi.fn(async () => 2);
const enfileirarResumosDiarios = vi.fn(async () => 1);
vi.mock("@/src/lib/avisos-equipe", () => ({
  entregarAvisosEquipe: (...a: unknown[]) => entregarAvisosEquipe(...a),
  enfileirarAvisosEmBreve: () => enfileirarAvisosEmBreve(),
  enfileirarResumosDiarios: () => enfileirarResumosDiarios(),
}));

beforeEach(() => {
  process.env.CRON_SECRET = "teste-cron";
  enfileirarLembretes.mockReset();
  enfileirarLembretes.mockResolvedValue(6);
  avaliarSessoes.mockReset();
  avaliarSessoes.mockResolvedValue(1);
  entregarPendentes.mockReset();
  entregarPendentes.mockResolvedValue({ enviados: 7, falhas: 2 });
  gerarSessoesRepetidas.mockReset();
  gerarSessoesRepetidas.mockResolvedValue(3);
  entregarAvisosEquipe.mockClear();
  enfileirarAvisosEmBreve.mockClear();
  enfileirarResumosDiarios.mockClear();
});

const comSegredo = () => new Request("http://x/api/cron/tick", { headers: { authorization: "Bearer teste-cron" } });

describe("GET /api/cron/tick", () => {
  it("recusa sem o segredo", async () => {
    const { GET } = await import("@/app/api/cron/tick/route");
    const r = await GET(new Request("http://x/api/cron/tick"));
    expect(r.status).toBe(401);
    expect(entregarPendentes).not.toHaveBeenCalled();
  });
  it("gera as sessões, fecha as vencidas, enfileira lembretes, avalia presença e entrega os eventos", async () => {
    const { GET } = await import("@/app/api/cron/tick/route");
    const r = await GET(comSegredo());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      sessoesCriadas: 3, limitesApagados: 5, transcricoesApagadas: 7, sessoesFechadas: 2, reunioesFechadas: 4,
      lembretes: 6, comecou: 0, sessoesAvaliadas: 1, eventosEnviados: 7, eventosFalhos: 2,
      avisosEquipeEnviados: 1, avisosEquipeFalhos: 0, avisosEmBreve: 2, resumosDiarios: 1,
    });
  });
  it("ordem: entrega primeiro (com prazo), depois os outros passos; lembretes antes da avaliação", async () => {
    const { GET } = await import("@/app/api/cron/tick/route");
    await GET(comSegredo());
    expect(entregarPendentes.mock.invocationCallOrder[0]).toBeLessThan(gerarSessoesRepetidas.mock.invocationCallOrder[0]);
    expect(entregarPendentes.mock.invocationCallOrder[0]).toBeLessThan(enfileirarLembretes.mock.invocationCallOrder[0]);
    expect(enfileirarLembretes.mock.invocationCallOrder[0]).toBeLessThan(avaliarSessoes.mock.invocationCallOrder[0]);
  });
  it("avisos da equipe: entrega depois dos passos críticos, com prazo de 45 s do começo do tick; enfileira em breve e resumo diário", async () => {
    const antes = Date.now();
    const { GET } = await import("@/app/api/cron/tick/route");
    await GET(comSegredo());
    const depois = Date.now();
    expect(avaliarSessoes.mock.invocationCallOrder.at(-1)!).toBeLessThan(entregarAvisosEquipe.mock.invocationCallOrder[0]);
    expect(gerarSessoesRepetidas.mock.invocationCallOrder.at(-1)!).toBeLessThan(entregarAvisosEquipe.mock.invocationCallOrder[0]);
    expect(entregarAvisosEquipe.mock.invocationCallOrder[0]).toBeLessThan(enfileirarAvisosEmBreve.mock.invocationCallOrder[0]);
    const [, , prazo] = entregarAvisosEquipe.mock.calls.at(-1) as [Date, number | undefined, Date];
    // Prazo contado do começo do tick (não de quando a entrega do lead terminou).
    expect(prazo.getTime()).toBeGreaterThanOrEqual(antes + 45_000);
    expect(prazo.getTime()).toBeLessThanOrEqual(depois + 45_000);
    expect(enfileirarAvisosEmBreve).toHaveBeenCalled();
    expect(enfileirarResumosDiarios).toHaveBeenCalled();
  });
  it("entrega recebe prazo de 40 s contados do começo do tick", async () => {
    const antes = Date.now();
    const { GET } = await import("@/app/api/cron/tick/route");
    await GET(comSegredo());
    const depois = Date.now();
    const [agora, , prazo] = entregarPendentes.mock.calls[0] as [Date, number | undefined, Date];
    expect(agora.getTime()).toBeGreaterThanOrEqual(antes);
    expect(agora.getTime()).toBeLessThanOrEqual(depois);
    expect(prazo.getTime() - agora.getTime()).toBe(40_000);
  });
  it("um passo que falha vira 0 e não para os outros", async () => {
    gerarSessoesRepetidas.mockRejectedValue(new Error("x"));
    enfileirarLembretes.mockRejectedValue(new Error("x"));
    avaliarSessoes.mockRejectedValue(new Error("x"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/tick/route");
    const r = await GET(comSegredo());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      sessoesCriadas: 0, limitesApagados: 5, transcricoesApagadas: 7, sessoesFechadas: 2, reunioesFechadas: 4,
      lembretes: 0, comecou: 0, sessoesAvaliadas: 0, eventosEnviados: 7, eventosFalhos: 2,
      avisosEquipeEnviados: 1, avisosEquipeFalhos: 0, avisosEmBreve: 2, resumosDiarios: 1,
    });
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
  it("entrega que falha vira 0 enviados e 0 falhos", async () => {
    entregarPendentes.mockRejectedValue(new Error("x"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/tick/route");
    const j = await (await GET(comSegredo())).json();
    expect(j.eventosEnviados).toBe(0);
    expect(j.eventosFalhos).toBe(0);
    erro.mockRestore();
  });
});
