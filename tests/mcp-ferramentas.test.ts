import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";

const m = vi.hoisted(() => {
  class ErroRtkFake extends Error {
    constructor(public status: number) {
      super(`RealtimeKit respondeu ${status}`);
    }
  }
  return { ErroRtkFake, linkDaGravacao: vi.fn(), criarReuniao: vi.fn() };
});

let f: ReturnType<typeof criarDbFalso>;
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => f.db }));
vi.mock("@/src/lib/realtimekit", () => ({ ErroRtk: m.ErroRtkFake, linkDaGravacao: (id: string) => m.linkDaGravacao(id) }));
vi.mock("@/src/lib/reunioes", () => ({ criarReuniao: (...a: unknown[]) => m.criarReuniao(...a) }));

process.env.NEXT_PUBLIC_SITE_URL = "https://call.exemplo.com.br/";

import { acharFerramenta, chamarFerramenta } from "@/src/lib/mcp/ferramentas";
import type { ChaveAutenticada } from "@/src/lib/mcp/auth";

const A1 = "11111111-1111-4111-8111-111111111111";
const S1 = "33333333-3333-4333-8333-333333333333";
const S2 = "44444444-4444-4444-8444-444444444444";
const I1 = "55555555-5555-4555-8555-555555555555";
const G1 = "fafafafa-fafa-4faf-8faf-fafafafafafa";
const NADA = "00000000-0000-4000-8000-000000000000";
const futuro = (dias: number) => new Date(Date.now() + dias * 86400_000).toISOString();

const ESCRITA: ChaveAutenticada = { id: "c1", nome: "Claude", permissao: "escrita", usuarioId: "u1" };
const LEITURA: ChaveAutenticada = { ...ESCRITA, permissao: "leitura" };

async function chamar(nome: string, args: Record<string, unknown> = {}, chave: ChaveAutenticada = ESCRITA) {
  const fer = acharFerramenta(nome);
  if (!fer) throw new Error(`sem ${nome}`);
  return chamarFerramenta(fer, chave, args);
}
const texto = (r: { content: { text: string }[] }) => r.content[0].text;

beforeEach(() => {
  m.linkDaGravacao.mockReset();
  m.criarReuniao.mockReset();
  f = criarDbFalso({
    agendas: [{ id: A1, nome: "Diagnóstico", slug: "diagnostico", ativa: true, duracao_min: 60, vagas_padrao: 30 }],
    sessoes: [
      { id: S1, agenda_id: A1, titulo: null, inicio: futuro(2), vagas: 30, status: "agendada" },
      { id: S2, agenda_id: A1, titulo: null, inicio: futuro(-2), vagas: 30, status: "encerrada" },
    ],
    inscricoes: [
      {
        id: I1,
        sessao_id: S1,
        agenda_id: A1,
        nome: "Ana",
        whatsapp: "+553139990000",
        email: "ana@x.com",
        origem: "type",
        utm: null,
        respostas: [{ pergunta: "Faturamento?", resposta: "50 mil" }],
        status: "agendado",
        minutos_na_sala: 0,
        created_at: "2026-10-20T10:00:00Z",
      },
      { id: "i2", sessao_id: S1, agenda_id: A1, nome: "Bia", whatsapp: "+553138880000", status: "cancelado", created_at: "2026-10-20T11:00:00Z" },
    ],
    presencas: [],
    eventos: [],
    fichas: [{ whatsapp: "+553139990000", resumo_ia: "Lead quente.", observacoes: "Ligar segunda." }],
    gravacoes: [
      { id: G1, sessao_id: S1, reuniao_id: null, rtk_recording_id: "rec1", status: "UPLOADED", duracao_s: 10, iniciada_em: futuro(-1), created_at: futuro(-1) },
    ],
    reunioes: [],
    usuarios: [{ id: "u1", nome: "Gabriel", ativo: true }],
  });
});

describe("leitura", () => {
  it("listar_agendas: texto + agendas com link", async () => {
    const r = await chamar("listar_agendas", {}, LEITURA);
    expect(texto(r)).toMatch(/^1 agenda\./);
    expect(r.structuredContent).toEqual({
      agendas: [{ id: A1, nome: "Diagnóstico", slug: "diagnostico", ativa: true, duracao_min: 60, vagas_padrao: 30, responsavel: null, link_agendar: "https://call.exemplo.com.br/agendar/diagnostico" }],
    });
  });

  it("listar_sessoes: padrão a partir de agora, conta só inscritos ativos; agenda inexistente → isError", async () => {
    const r = await chamar("listar_sessoes", { agenda: "diagnostico" }, LEITURA);
    const sessoes = (r.structuredContent as { sessoes: { id: string; inscritos: number }[] }).sessoes;
    expect(sessoes.map((s) => s.id)).toEqual([S1]);
    expect(sessoes[0].inscritos).toBe(1);
    expect(texto(r)).toMatch(/^1 sessão\./);
    const erro = await chamar("listar_sessoes", { agenda: "nao-tem" }, LEITURA);
    expect(erro).toEqual({ content: [{ type: "text", text: "Agenda não encontrada." }], isError: true });
  });

  it("listar_sessoes: aceita data com espaço; data inválida → isError com o campo", async () => {
    const de = new Date(Date.now() - 5 * 86400_000).toISOString().slice(0, 10) + " 00:00";
    const r = await chamar("listar_sessoes", { de }, LEITURA);
    expect((r.structuredContent as { sessoes: unknown[] }).sessoes).toHaveLength(2);
    const erro = await chamar("listar_sessoes", { de: "ontem" }, LEITURA);
    expect(erro.isError).toBe(true);
    expect(texto(erro)).toMatch(/"de"/);
  });

  it("ver_inscritos: todos os status com dados pessoais; sessão inexistente → isError; id ruim → isError", async () => {
    const r = await chamar("ver_inscritos", { sessao: S1 }, LEITURA);
    const inscritos = (r.structuredContent as { inscritos: { nome: string; whatsapp: string }[] }).inscritos;
    expect(inscritos.map((i) => i.nome)).toEqual(["Ana", "Bia"]);
    expect(inscritos[0].whatsapp).toBe("+553139990000");
    expect(texto(r)).toMatch(/^2 inscritos\./);
    expect(texto(await chamar("ver_inscritos", { sessao: NADA }, LEITURA))).toBe("Sessão não encontrada.");
    expect(await chamar("ver_inscritos", { sessao: "x" }, LEITURA)).toEqual({ content: [{ type: "text", text: "Id inválido." }], isError: true });
  });

  it("ver_ficha: respostas, resumo e observações; inscrição de outra sessão → isError", async () => {
    const r = await chamar("ver_ficha", { sessao: S1, inscricao: I1 }, LEITURA);
    expect(r.isError).toBeUndefined();
    const ficha = (r.structuredContent as { ficha: Record<string, unknown> }).ficha;
    expect(ficha).toMatchObject({
      nome: "Ana",
      respostas: [{ pergunta: "Faturamento?", resposta: "50 mil" }],
      resumo: { estado: "pronto", texto: "Lead quente." },
      observacoes: "Ligar segunda.",
    });
    expect(texto(r)).toBe("Ficha de Ana: 1 resposta, resumo pronto, com observações.");
    const erro = await chamar("ver_ficha", { sessao: S2, inscricao: I1 }, LEITURA);
    expect(erro).toEqual({ content: [{ type: "text", text: "Inscrição não encontrada nesta sessão." }], isError: true });
  });

  it("listar_gravacoes: com disponibilidade; período invertido → isError", async () => {
    const r = await chamar("listar_gravacoes", {}, LEITURA);
    const gravacoes = (r.structuredContent as { gravacoes: { id: string; expirada: boolean }[] }).gravacoes;
    expect(gravacoes.map((g) => g.id)).toEqual([G1]);
    expect(texto(r)).toMatch(/Disponível até/);
    const erro = await chamar("listar_gravacoes", { de: "2026-10-20", ate: "2026-10-10" }, LEITURA);
    expect(texto(erro)).toBe('"de" precisa ser antes de "ate".');
    expect(erro.isError).toBe(true);
  });

  it("link_gravacao: link pedido na hora; apagada no RealtimeKit → isError indisponível", async () => {
    m.linkDaGravacao.mockResolvedValue({ url: "https://r2/arquivo.mp4", expira: null });
    const r = await chamar("link_gravacao", { gravacao: G1 }, LEITURA);
    expect(r.structuredContent).toEqual({ url: "https://r2/arquivo.mp4", expira: null });
    expect(texto(r)).toBe("Link da gravação: https://r2/arquivo.mp4");
    expect(m.linkDaGravacao).toHaveBeenCalledWith("rec1");
    m.linkDaGravacao.mockRejectedValue(new m.ErroRtkFake(404));
    expect(texto(await chamar("link_gravacao", { gravacao: G1 }, LEITURA))).toBe("Gravação indisponível.");
  });
});

describe("escrita", () => {
  it("chave de leitura nas 3 ferramentas de escrita → isError, sem mudar nada", async () => {
    for (const nome of ["criar_sessao", "cancelar_sessao", "criar_reuniao"]) {
      const r = await chamar(nome, { agenda: "diagnostico", inicio: "2030-01-01 10:00", sessao: S1, confirmar: true }, LEITURA);
      expect(r).toEqual({ content: [{ type: "text", text: "Esta chave é só de leitura." }], isError: true });
    }
    expect(f.chamadas).toHaveLength(0);
    expect(m.criarReuniao).not.toHaveBeenCalled();
  });

  it("criar_sessao: aceita 'AAAA-MM-DD HH:mm' em Brasília e usa as vagas da agenda", async () => {
    const r = await chamar("criar_sessao", { agenda: "diagnostico", inicio: "2030-01-10 14:00", titulo: "Turma" });
    expect(r.isError).toBeUndefined();
    const sessao = (r.structuredContent as { sessao: { inicio: string; vagas: number; titulo: string } }).sessao;
    expect(sessao).toMatchObject({ inicio: "2030-01-10T17:00:00.000Z", vagas: 30, titulo: "Turma" });
    expect(texto(r)).toMatch(/^Sessão criada para .+ \(30 vagas\)\. Id: /);
  });

  it("criar_sessao: aceita ISO; passado ou agenda desativada → isError", async () => {
    const iso = await chamar("criar_sessao", { agenda: "diagnostico", inicio: "2030-01-10T14:00:00-03:00", vagas: 5 });
    expect((iso.structuredContent as { sessao: { inicio: string; vagas: number } }).sessao).toMatchObject({ inicio: "2030-01-10T17:00:00.000Z", vagas: 5 });
    expect(texto(await chamar("criar_sessao", { agenda: "diagnostico", inicio: "2020-01-10 14:00" }))).toBe("Escolha uma data e hora no futuro.");
    f.tabelas.agendas[0].ativa = false;
    const r = await chamar("criar_sessao", { agenda: "diagnostico", inicio: "2030-01-10 14:00" });
    expect(r).toEqual({ content: [{ type: "text", text: "Essa agenda não existe ou está desativada." }], isError: true });
  });

  it("cancelar_sessao sem confirmar: só avisa o total de inscritos e não muda nada", async () => {
    const r = await chamar("cancelar_sessao", { sessao: S1 });
    expect(r.isError).toBeUndefined();
    expect(texto(r)).toMatch(/^A sessão de .+ tem 1 inscritos ativos\. Chame de novo com confirmar=true para cancelar\.$/);
    expect((r.structuredContent as { cancelada: boolean }).cancelada).toBe(false);
    expect(f.tabelas.sessoes[0].status).toBe("agendada");
    expect(f.chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("cancelar_sessao com confirmar=true: cancela sessão e inscrições; já encerrada → isError", async () => {
    const r = await chamar("cancelar_sessao", { sessao: S1, confirmar: true });
    expect(texto(r)).toMatch(/^Sessão de .+ cancelada\.$/);
    expect(f.tabelas.sessoes[0].status).toBe("cancelada");
    expect(f.tabelas.inscricoes[0].status).toBe("cancelado");
    expect(await chamar("cancelar_sessao", { sessao: S2, confirmar: true })).toEqual({
      content: [{ type: "text", text: "Só dá para cancelar sessão agendada." }],
      isError: true,
    });
    expect(texto(await chamar("cancelar_sessao", { sessao: NADA }))).toBe("Sessão não encontrada.");
  });

  it("criar_reuniao: em nome do dono da chave; chave sem dono → isError", async () => {
    m.criarReuniao.mockResolvedValue({ codigo: "abc-defg-hij" });
    const r = await chamar("criar_reuniao", { titulo: "Alinhamento" });
    expect(r.structuredContent).toEqual({ codigo: "abc-defg-hij", link: "https://call.exemplo.com.br/r/abc-defg-hij" });
    expect(texto(r)).toBe("Reunião criada: https://call.exemplo.com.br/r/abc-defg-hij");
    expect(m.criarReuniao).toHaveBeenCalledWith({ id: "u1", nome: "Gabriel" }, "Alinhamento");
    const semDono = await chamar("criar_reuniao", {}, { ...ESCRITA, usuarioId: null });
    expect(semDono.isError).toBe(true);
    expect(texto(semDono)).toMatch(/não tem mais um dono/);
  });
});
