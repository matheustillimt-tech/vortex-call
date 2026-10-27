import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Resposta = { data?: unknown; error?: unknown };
let filas: Record<string, Resposta[]> = {};
let chamadas: { tabela: string; metodo: string; args: unknown[] }[] = [];

/** Banco falso: cada `from(tabela)` devolve a próxima resposta da fila daquela tabela (ou `{ data: null }`). */
function consulta(tabela: string) {
  const proxima = () => Promise.resolve({ data: null, error: null, ...(filas[tabela]?.shift() ?? {}) });
  const registrar = (metodo: string) => (...args: unknown[]) => {
    chamadas.push({ tabela, metodo, args });
    return q;
  };
  const q: Record<string, unknown> = {
    select: registrar("select"),
    eq: registrar("eq"),
    neq: registrar("neq"),
    order: registrar("order"),
    limit: registrar("limit"),
    maybeSingle: () => proxima(),
    then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => proxima().then(ok, falha),
    upsert: (...args: unknown[]) => {
      chamadas.push({ tabela, metodo: "upsert", args });
      return proxima();
    },
  };
  return q;
}
const db = { from: (t: string) => consulta(t) } as unknown as SupabaseClient;

const INSC = {
  id: "i1",
  nome: "Ana Souza",
  whatsapp: "+551137654321",
  email: "ana@x.com",
  origem: "encaixe",
  utm: { utm_source: "instagram" },
  respostas: { "Qual seu negócio?": "Clínica" },
  created_at: "2026-10-20T13:00:00+00:00",
};
const IA = { openrouterKey: "k", modelo: "m" };
const iaResponde = (conteudo: string, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }] }), { status }));

beforeEach(() => {
  filas = {};
  chamadas = [];
  process.env.NEXT_PUBLIC_SITE_URL = "https://call.exemplo.com";
});

const fez = (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo);

describe("lerFicha", () => {
  it("inscrição de outra sessão: null (filtra pela sessão)", async () => {
    const { lerFicha } = await import("@/src/lib/ficha");
    filas.inscricoes = [{ data: null }];
    expect(await lerFicha(db, "s1", "i1")).toBeNull();
    expect(fez("inscricoes", "eq").map((c) => c.args)).toEqual([["id", "i1"], ["sessao_id", "s1"]]);
    expect(fez("fichas", "select")).toHaveLength(0);
  });

  it("monta a ficha completa com resumo pendente", async () => {
    const { lerFicha } = await import("@/src/lib/ficha");
    filas.inscricoes = [
      { data: INSC },
      { data: [{ status: "faltou", sessoes: { inicio: "2026-10-13T12:00:00+00:00" }, agendas: { nome: "Vendas" } }] },
    ];
    filas.fichas = [{ data: { resumo_ia: null, observacoes: "liga à tarde" } }];
    expect(await lerFicha(db, "s1", "i1")).toEqual({
      inscricaoId: "i1",
      nome: "Ana Souza",
      whatsapp: "+551137654321",
      linkWhatsapp: "https://wa.me/551137654321",
      email: "ana@x.com",
      origem: "Agendamento encaixado em outra página",
      utm: [{ rotulo: "Fonte", valor: "instagram" }],
      inscritoEm: "20/10/2026 às 10:00",
      respostas: [{ pergunta: "Qual seu negócio?", resposta: "Clínica" }],
      anteriores: [{ quando: "13/10/2026 às 09:00", agenda: "Vendas", situacao: "Faltou" }],
      resumo: { estado: "pendente" },
      observacoes: "liga à tarde",
      ultimaCall: null,
    });
    expect(fez("inscricoes", "neq").map((c) => c.args)).toEqual([["id", "i1"]]);
  });

  it("resumo salvo: pronto; sem respostas e sem ficha: sem_dados e observações vazias", async () => {
    const { lerFicha } = await import("@/src/lib/ficha");
    filas.inscricoes = [{ data: INSC }, { data: [] }];
    filas.fichas = [{ data: { resumo_ia: "Ana quer agenda cheia.", observacoes: "" } }];
    expect((await lerFicha(db, "s1", "i1"))?.resumo).toEqual({ estado: "pronto", texto: "Ana quer agenda cheia." });

    filas.inscricoes = [{ data: { ...INSC, respostas: null } }, { data: [] }];
    filas.fichas = [{ data: null }];
    const f = await lerFicha(db, "s1", "i1");
    expect(f?.resumo).toEqual({ estado: "sem_dados" });
    expect(f?.observacoes).toBe("");
    expect(f?.respostas).toEqual([]);
  });
});

describe("lerFicha pela service role, pra membro", () => {
  it("sessões anteriores só das agendas em que ele é o responsável (como a RLS fazia)", async () => {
    const { lerFicha } = await import("@/src/lib/ficha");
    filas.inscricoes = [{ data: INSC }, { data: [] }];
    filas.fichas = [{ data: null }];
    await lerFicha(db, "s1", "i1", "u-hugo");
    expect(fez("inscricoes", "select").map((c) => c.args[0])).toContain("status, sessoes(inicio), agendas!inner(nome)");
    expect(fez("inscricoes", "eq").map((c) => c.args)).toContainEqual(["agendas.responsavel_id", "u-hugo"]);
  });
});

describe("gerarResumo", () => {
  it("já tem resumo: devolve sem chamar a IA", async () => {
    const { gerarResumo } = await import("@/src/lib/ficha");
    filas.inscricoes = [{ data: INSC }];
    filas.fichas = [{ data: { resumo_ia: "Pronto." } }];
    const f = iaResponde('{"resumo":"novo"}');
    expect(await gerarResumo(db, "s1", "i1", IA, f as unknown as typeof fetch)).toEqual({ estado: "pronto", texto: "Pronto." });
    expect(f).not.toHaveBeenCalled();
  });

  it("sem respostas: sem_dados e não chama a IA", async () => {
    const { gerarResumo } = await import("@/src/lib/ficha");
    filas.inscricoes = [{ data: { ...INSC, respostas: {} } }];
    const f = iaResponde('{"resumo":"x"}');
    expect(await gerarResumo(db, "s1", "i1", IA, f as unknown as typeof fetch)).toEqual({ estado: "sem_dados" });
    expect(f).not.toHaveBeenCalled();
  });

  it("gera, limpa o travessão e salva por WhatsApp; contato não vai pra IA", async () => {
    const { gerarResumo } = await import("@/src/lib/ficha");
    filas.inscricoes = [{ data: INSC }];
    const f = iaResponde('{"resumo":"Ana — dona de clínica."}');
    expect(await gerarResumo(db, "s1", "i1", IA, f as unknown as typeof fetch)).toEqual({ estado: "pronto", texto: "Ana, dona de clínica." });
    const corpo = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { messages: { content: string }[] };
    expect(corpo.messages[1].content).toContain("Clínica");
    expect(corpo.messages[1].content).not.toContain("+551137654321");
    expect(corpo.messages[1].content).not.toContain("ana@x.com");
    const [up] = fez("fichas", "upsert");
    expect(up.args).toEqual([
      { whatsapp: "+551137654321", resumo_ia: "Ana, dona de clínica.", resumo_em: expect.any(String) },
      { onConflict: "whatsapp" },
    ]);
  });

  it("IA falhou: falhou e nada é salvo", async () => {
    const { gerarResumo } = await import("@/src/lib/ficha");
    filas.inscricoes = [{ data: INSC }];
    const f = iaResponde("", 500);
    expect(await gerarResumo(db, "s1", "i1", IA, f as unknown as typeof fetch)).toEqual({ estado: "falhou" });
    expect(fez("fichas", "upsert")).toHaveLength(0);
  });

  it("inscrição de outra sessão: null", async () => {
    const { gerarResumo } = await import("@/src/lib/ficha");
    filas.inscricoes = [{ data: null }];
    expect(await gerarResumo(db, "s1", "i1", IA, iaResponde("{}") as unknown as typeof fetch)).toBeNull();
  });
});

describe("salvarObservacoes", () => {
  it("inscrição de outra sessão: nao_encontrada", async () => {
    const { salvarObservacoes } = await import("@/src/lib/ficha");
    filas.inscricoes = [{ data: null }];
    expect(await salvarObservacoes(db, "s1", "i1", "x")).toBe("nao_encontrada");
    expect(fez("fichas", "upsert")).toHaveLength(0);
  });

  it("salva só as observações, por WhatsApp", async () => {
    const { salvarObservacoes } = await import("@/src/lib/ficha");
    filas.inscricoes = [{ data: INSC }];
    expect(await salvarObservacoes(db, "s1", "i1", "liga à tarde")).toBe("ok");
    expect(fez("fichas", "upsert")[0].args).toEqual([{ whatsapp: "+551137654321", observacoes: "liga à tarde" }, { onConflict: "whatsapp" }]);
  });

  it("erro do banco: erro", async () => {
    const { salvarObservacoes } = await import("@/src/lib/ficha");
    filas.inscricoes = [{ data: INSC }];
    filas.fichas = [{ error: { message: "x" } }];
    expect(await salvarObservacoes(db, "s1", "i1", "x")).toBe("erro");
  });
});

describe("salvarObservacoes sem contato_lead", () => {
  it("observações salvas com contato: recusa (travada) sem gravar", async () => {
    const { salvarObservacoes } = await import("@/src/lib/ficha");
    filas.inscricoes = [{ data: INSC }];
    filas.fichas = [{ data: { observacoes: "Liga no 11 3888-7766" } }];
    expect(await salvarObservacoes(db, "s1", "i1", "Liga no +55 11 3••••-7766 depois", true)).toBe("travada");
    expect(fez("fichas", "upsert")).toHaveLength(0);
  });
  it("observações sem contato: salva normal", async () => {
    const { salvarObservacoes } = await import("@/src/lib/ficha");
    filas.inscricoes = [{ data: INSC }];
    filas.fichas = [{ data: { observacoes: "Prefere à tarde" } }, { error: null }];
    expect(await salvarObservacoes(db, "s1", "i1", "Prefere à tarde, sexta", true)).toBe("ok");
    expect(fez("fichas", "upsert")).toHaveLength(1);
  });
});
