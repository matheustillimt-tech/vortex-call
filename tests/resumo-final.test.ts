import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";

let banco = criarDbFalso({});
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => banco.db }));
const listarTrechos = vi.fn<(s: string) => Promise<unknown[]>>(async () => []);
vi.mock("@/src/lib/transcricao", () => ({ listarTrechos: (s: string) => listarTrechos(s) }));
let ia: { openrouterKey: string; modelo: string } | null = { openrouterKey: "k", modelo: "m" };
vi.mock("@/src/lib/env", () => ({ iaConfig: () => ia, siteUrl: () => "https://call.x" }));
const completarJson = vi.fn<(...a: unknown[]) => Promise<Record<string, unknown>>>();
vi.mock("@/src/lib/openrouter", () => ({ completarJson: (...a: unknown[]) => completarJson(...a) }));
const enfileirar = vi.fn<(...a: unknown[]) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/eventos", () => ({ enfileirar: (...a: unknown[]) => enfileirar(...a) }));

const AGORA = new Date("2026-10-26T19:00:00.000Z");
const fala = (id: string, min: number, nome = "Ana", customId: string | null = "insc-1") => ({
  id, nome, customId, texto: "fala", em: new Date(Date.parse("2026-10-26T18:00:00.000Z") + min * 60_000).toISOString(),
});
const RESPOSTA = { negocio: "Clínica", dor: "Perde lead", quer: "Responder rápido", combinado: ["Proposta sexta"], escopo: [], orcamento_prazo: "", objecoes: [], proximo_passo: "Mandar proposta", temperatura: "quente", temperatura_motivo: "" };

function sessao(extra: Record<string, unknown> = {}) {
  return {
    id: "s1", titulo: null, inicio: "2026-10-26T18:00:00.000Z", anfitriao_id: "u1", agenda_id: "ag1",
    resumo_estado: "pendente", resumo_apos: "2026-10-26T18:50:00.000Z", resumo_tentativas: 0, avaliada_em: "2026-10-26T18:45:00.000Z",
    rtk_meeting_id: "m1", rtk_transcreve: true, ...extra,
  };
}

beforeEach(() => {
  banco = criarDbFalso({
    sessoes: [sessao()],
    agendas: [{ id: "ag1", nome: "Implementação de IA" }],
    usuarios: [{ id: "u1", nome: "Gabriel Ramos" }],
    inscricoes: [
      { id: "i1", sessao_id: "s1", status: "compareceu", whatsapp: "+553239990001" },
      { id: "i2", sessao_id: "s1", status: "faltou", whatsapp: "+553239990002" },
    ],
  });
  listarTrechos.mockReset();
  listarTrechos.mockResolvedValue([]);
  completarJson.mockReset();
  enfileirar.mockClear();
  ia = { openrouterKey: "k", modelo: "m" };
});

describe("gerarProximoResumo", () => {
  it("fila vazia, ainda não chegou a hora ou sessão não avaliada: nenhum", async () => {
    const { gerarProximoResumo } = await import("@/src/lib/resumo-final");
    banco.tabelas.sessoes = [sessao({ resumo_apos: "2026-10-26T19:30:00.000Z" })];
    expect(await gerarProximoResumo(AGORA)).toBe("nenhum");
    banco.tabelas.sessoes = [sessao({ avaliada_em: null })];
    expect(await gerarProximoResumo(AGORA)).toBe("nenhum");
    banco.tabelas.sessoes = [sessao({ resumo_estado: "pronto" })];
    expect(await gerarProximoResumo(AGORA)).toBe("nenhum");
  });

  it("com a transcrição da Cloudflare: resumo final, evento resumo só pra quem veio e ficha atualizada", async () => {
    banco.tabelas.transcricoes = [{ sessao_id: "s1", conteudo: [fala("cf:1", 0, "Gabriel", "membro:u1"), fala("cf:2", 10), fala("cf:3", 40)] }];
    completarJson.mockResolvedValue(RESPOSTA);
    const { gerarProximoResumo } = await import("@/src/lib/resumo-final");
    expect(await gerarProximoResumo(AGORA)).toBe("pronto");

    const final = banco.tabelas.alinhamentos[0];
    expect(final).toMatchObject({ sessao_id: "s1", tipo: "final", origem: "cloudflare", total_trechos: 3 });
    expect(final.texto).toMatch(/^RESUMO DA CALL \(26\/10 15:00, 40 min, conduzida por Gabriel\)\nNegócio: Clínica/);
    expect(listarTrechos).not.toHaveBeenCalled();
    expect((completarJson.mock.calls[0][0] as { usuario: string }).usuario).toContain("resumo final");

    expect(enfileirar).toHaveBeenCalledTimes(1);
    expect(enfileirar).toHaveBeenCalledWith("resumo", "i1", AGORA, { resumo: { texto: final.texto, dados: expect.objectContaining({ negocio: "Clínica" }) } });
    expect(banco.tabelas.fichas).toEqual([expect.objectContaining({ whatsapp: "+553239990001", observacoes_call: final.texto })]);
    expect(banco.tabelas.sessoes[0]).toMatchObject({ resumo_estado: "pronto", resumo_apos: null });
  });

  it("sem a da Cloudflare usa a do ao vivo; mais de um lead = call em grupo", async () => {
    banco.tabelas.inscricoes.push({ id: "i3", sessao_id: "s1", status: "compareceu", whatsapp: "+553239990003" });
    listarTrechos.mockResolvedValue([fala("1", 0), fala("2", 5)]);
    completarJson.mockResolvedValue(RESPOSTA);
    const { gerarProximoResumo } = await import("@/src/lib/resumo-final");
    expect(await gerarProximoResumo(AGORA)).toBe("pronto");
    expect(banco.tabelas.alinhamentos[0].origem).toBe("ao_vivo");
    expect(banco.tabelas.alinhamentos[0].texto).toContain("\nCall em grupo com 2 leads\n");
    expect(enfileirar).toHaveBeenCalledTimes(2);
  });

  it("menos de 3 min de conversa: sem_fala, sem IA e sem evento", async () => {
    listarTrechos.mockResolvedValue([fala("1", 0), fala("2", 1)]);
    const { gerarProximoResumo } = await import("@/src/lib/resumo-final");
    expect(await gerarProximoResumo(AGORA)).toBe("sem_fala");
    expect(completarJson).not.toHaveBeenCalled();
    expect(enfileirar).not.toHaveBeenCalled();
    expect(banco.tabelas.sessoes[0].resumo_estado).toBe("sem_fala");
  });

  it("IA falhou: tenta de novo em 5 min; na 3ª, falhou e o evento leva o começo da transcrição", async () => {
    listarTrechos.mockResolvedValue([fala("1", 0), fala("2", 5)]);
    completarJson.mockRejectedValue(new Error("A IA não respondeu."));
    const { gerarProximoResumo } = await import("@/src/lib/resumo-final");
    expect(await gerarProximoResumo(AGORA)).toBe("repetir");
    expect(banco.tabelas.sessoes[0]).toMatchObject({ resumo_estado: "pendente", resumo_tentativas: 1, resumo_apos: "2026-10-26T19:05:00.000Z" });
    expect(enfileirar).not.toHaveBeenCalled();

    banco.tabelas.sessoes = [sessao({ resumo_tentativas: 2 })];
    expect(await gerarProximoResumo(AGORA)).toBe("falhou");
    const texto = (enfileirar.mock.calls[0][3] as { resumo: { texto: string } }).resumo.texto;
    expect(texto).toContain("O resumo automático falhou");
    expect(texto).toContain("Ana: fala");
    expect(banco.tabelas.sessoes[0].resumo_estado).toBe("falhou");
    expect(banco.tabelas.alinhamentos ?? []).toHaveLength(0);
  });
});

describe("receberTranscricao", () => {
  const payload = (extra: Record<string, unknown> = {}) => ({
    event: "meeting.transcript",
    meeting: { id: "m1", sessionId: "rtk-s1", startedAt: "2026-10-26T18:00:00.000Z" },
    transcriptDownloadUrl: "https://cf.x/t.csv",
    ...extra,
  });

  it("baixa o CSV, grava as falas e antecipa o resumo pra já", async () => {
    banco.tabelas.sessoes = [sessao({ resumo_estado: null, resumo_apos: null })];
    const f = vi.fn(async () => new Response('"1000","p1","u1","insc-1","Ana","Quero um agente"\n"65000","p2","u2","membro:u1","Gabriel","Fechado"'));
    const { receberTranscricao } = await import("@/src/lib/resumo-final");
    await receberTranscricao(payload(), f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith("https://cf.x/t.csv", expect.anything());
    expect(banco.tabelas.transcricoes).toEqual([expect.objectContaining({
      sessao_id: "s1", rtk_session_id: "rtk-s1",
      conteudo: [
        { id: "cf:rtk-s1:0", nome: "Ana", customId: "insc-1", texto: "Quero um agente", em: "2026-10-26T18:00:01.000Z" },
        { id: "cf:rtk-s1:1", nome: "Gabriel", customId: "membro:u1", texto: "Fechado", em: "2026-10-26T18:01:05.000Z" },
      ],
    })]);
    expect(banco.tabelas.sessoes[0]).toMatchObject({ resumo_estado: "pendente", resumo_tentativas: 0 });
    expect(Date.parse(banco.tabelas.sessoes[0].resumo_apos as string)).toBeLessThanOrEqual(Date.now());
  });

  it("meeting de sessão sem transcrição (ou que não é de sessão) é ignorada", async () => {
    banco.tabelas.sessoes = [sessao({ rtk_transcreve: false, resumo_estado: null })];
    const f = vi.fn();
    const { receberTranscricao } = await import("@/src/lib/resumo-final");
    await receberTranscricao(payload(), f as unknown as typeof fetch);
    await receberTranscricao(payload({ meeting: { id: "outra", sessionId: "x" } }), f as unknown as typeof fetch);
    expect(f).not.toHaveBeenCalled();
    expect(banco.tabelas.transcricoes ?? []).toHaveLength(0);
  });

  it("download falhou: lança (o webhook devolve 500 e a Cloudflare reenvia)", async () => {
    const f = vi.fn(async () => new Response("x", { status: 403 }));
    const { receberTranscricao } = await import("@/src/lib/resumo-final");
    await expect(receberTranscricao(payload(), f as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("marcarResumoPendente e cabeçalho", () => {
  it("soSeVazio não mexe em sessão que já está na fila", async () => {
    const { marcarResumoPendente } = await import("@/src/lib/resumo-final");
    await marcarResumoPendente("s1", new Date("2026-10-26T20:00:00.000Z"), true);
    expect(banco.tabelas.sessoes[0].resumo_apos).toBe("2026-10-26T18:50:00.000Z");
    banco.tabelas.sessoes = [sessao({ resumo_estado: null })];
    await marcarResumoPendente("s1", new Date("2026-10-26T20:00:00.000Z"), true);
    expect(banco.tabelas.sessoes[0]).toMatchObject({ resumo_estado: "pendente", resumo_apos: "2026-10-26T20:00:00.000Z" });
  });
  it("cabeçalho com data de Brasília, minutos e quem conduziu", async () => {
    const { cabecalhoDoResumo } = await import("@/src/lib/resumo-final");
    expect(cabecalhoDoResumo({ inicio: "2026-10-26T18:00:00.000Z", minutos: 41.6, conduzidaPor: "Gabriel", leads: 1 })).toBe("RESUMO DA CALL (26/10 15:00, 42 min, conduzida por Gabriel)");
    expect(cabecalhoDoResumo({ inicio: "2026-10-26T18:00:00.000Z", minutos: 0.2, conduzidaPor: null, leads: 3 })).toBe("RESUMO DA CALL (26/10 15:00, 1 min)\nCall em grupo com 3 leads");
  });
});
