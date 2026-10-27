import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";

let f: ReturnType<typeof criarDbFalso>;
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => f.db }));

const DADOS = { negocio: "Clínica", dor: "", quer: "", combinado: [], escopo: [], orcamento_prazo: "", objecoes: [], proximo_passo: "", temperatura: null, temperatura_motivo: "" };
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  f = criarDbFalso({
    sessoes: [
      { id: S1, titulo: null, inicio: "2026-10-20T18:00:00.000Z", rtk_transcreve: true, resumo_estado: "pronto" },
      { id: S2, titulo: null, inicio: "2026-10-26T18:00:00.000Z", rtk_transcreve: true, resumo_estado: "pendente" },
    ],
    alinhamentos: [{ sessao_id: S1, tipo: "final", texto: "RESUMO DA CALL\nNegócio: Clínica", dados: DADOS, origem: "cloudflare", gerado_em: "2026-10-20T19:00:00.000Z" }],
    transcricoes: [{ sessao_id: S1, conteudo: [{ id: "cf:1", nome: "Ana", customId: "i1", texto: "Oi", em: "2026-10-20T18:01:00.000Z" }] }],
    transcricao_trechos: [{ sessao_id: S2, rtk_id: "t1", falante_nome: "Bento", custom_id: null, texto: "Bom dia", falado_em: "2026-10-26T18:02:00.000Z" }],
    inscricoes: [
      { id: "i1", nome: "Ana Souza", whatsapp: "+553239990001", status: "compareceu", sessao_id: S1 },
      { id: "i2", nome: "Ana Souza", whatsapp: "+553239990001", status: "faltou", sessao_id: S2 },
    ],
  });
});

describe("resumoDaSessao", () => {
  it("pronto: devolve o texto e os dados; com transcrição, a da Cloudflare", async () => {
    const { resumoDaSessao } = await import("@/src/lib/api/resumos");
    const r = await resumoDaSessao(f.db, S1, { comTranscricao: true });
    expect(r.estado).toBe("pronto");
    expect(r.resumo?.texto).toContain("Negócio: Clínica");
    expect(r.transcricao).toBe("[15:01] Ana: Oi");
    expect(r.transcricao_cortada).toBe(false);
  });
  it("sem a da Cloudflare, transcrição do ao vivo; sem final ainda, resumo null", async () => {
    const { resumoDaSessao } = await import("@/src/lib/api/resumos");
    const r = await resumoDaSessao(f.db, S2, { comTranscricao: true });
    expect([r.estado, r.resumo, r.transcricao]).toEqual(["pendente", null, "[15:02] Bento: Bom dia"]);
  });
  it("sessão não transcrita: sem_transcricao; inexistente: 404", async () => {
    f.tabelas.sessoes.push({ id: "33333333-3333-4333-8333-333333333333", inicio: "2026-10-26T18:00:00.000Z", rtk_transcreve: false, resumo_estado: null });
    const { resumoDaSessao } = await import("@/src/lib/api/resumos");
    expect((await resumoDaSessao(f.db, "33333333-3333-4333-8333-333333333333")).estado).toBe("sem_transcricao");
    await expect(resumoDaSessao(f.db, "44444444-4444-4444-8444-444444444444")).rejects.toMatchObject({ status: 404 });
  });
});

describe("resumoPorWhatsapp", () => {
  it("última call que o lead compareceu (aceita número sem DDI)", async () => {
    const { resumoPorWhatsapp } = await import("@/src/lib/api/resumos");
    const r = await resumoPorWhatsapp(f.db, "(32) 3999-0001");
    expect([r.lead, r.sessao.id, r.estado]).toEqual(["Ana Souza", S1, "pronto"]);
  });
  it("sem call transcrita: 404; número inválido: 422", async () => {
    const { resumoPorWhatsapp } = await import("@/src/lib/api/resumos");
    await expect(resumoPorWhatsapp(f.db, "+553239990009")).rejects.toMatchObject({ status: 404 });
    await expect(resumoPorWhatsapp(f.db, "abc")).rejects.toMatchObject({ status: 422 });
  });
});

describe("MCP ver_resumo_call", () => {
  it("pela sessão ou pelo WhatsApp: o texto do resumo; na fila, avisa", async () => {
    const { acharFerramenta } = await import("@/src/lib/mcp/ferramentas");
    const ferramenta = acharFerramenta("ver_resumo_call")!;
    expect(ferramenta.escrita).toBe(false);
    const chave = { id: "k", nome: "k", permissao: "leitura" as const, usuarioId: null };
    const porSessao = await ferramenta.executar(chave, { sessao: S1 });
    expect(porSessao.content[0].text).toContain("Negócio: Clínica");
    const porWhats = await ferramenta.executar(chave, { whatsapp: "+553239990001" });
    expect(porWhats.content[0].text).toContain("com Ana Souza");
    const pendente = await ferramenta.executar(chave, { sessao: S2 });
    expect(pendente.content[0].text).toContain("está na fila");
  });
});
