import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const tabelas: Record<string, unknown> = {};
function consulta(tabela: string) {
  const q = {
    select: () => q, eq: () => q,
    maybeSingle: async () => ({ data: tabelas[tabela] ?? null }),
  };
  return q;
}
const dentroDoLimite = vi.fn<(chave: string, maximo: number) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from: consulta, rpc }) }));
vi.mock("@/src/lib/limite", () => ({ dentroDoLimite: (chave: string, maximo: number) => dentroDoLimite(chave, maximo) }));
const enfileirar = vi.fn<(evento: string, inscricaoId: string) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/eventos", () => ({ enfileirar: (evento: string, inscricaoId: string) => enfileirar(evento, inscricaoId) }));

const avisarNovoAgendamento = vi.fn<(inscricaoId: string, reagendou: boolean) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/avisos-equipe", () => ({
  avisarNovoAgendamento: (inscricaoId: string, reagendou: boolean) => avisarNovoAgendamento(inscricaoId, reagendou),
}));

const SESSAO = "8a8f2d9e-2b1c-4c55-9f0a-0f6a3b7f1d11";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://call.exemplo.com.br";
  process.env.CRYPTO_KEY = "a".repeat(64);
  tabelas.agendas = { id: "ag1", titulo_publico: "Call", duracao_min: 60 };
  tabelas.sessoes = { id: SESSAO, inicio: "2026-10-27T12:00:00Z", agenda_id: "ag1" };
  rpc.mockReset();
  dentroDoLimite.mockReset();
  dentroDoLimite.mockResolvedValue(true);
  enfileirar.mockReset();
  enfileirar.mockResolvedValue(true);
  avisarNovoAgendamento.mockReset();
  avisarNovoAgendamento.mockResolvedValue(true);
});

describe("aviso pro vendedor da agenda", () => {
  it("nova avisa como agendamento; reagendada avisa como reagendamento; mesma não avisa", async () => {
    rpc.mockResolvedValue({ data: [{ resultado: "nova", inscricao_id: "i1", codigo: "abcdefghjk" }], error: null });
    await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    rpc.mockResolvedValue({ data: [{ resultado: "reagendada", inscricao_id: "i2", codigo: "abcdefghjk" }], error: null });
    await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    rpc.mockResolvedValue({ data: [{ resultado: "mesma", inscricao_id: "i3", codigo: "abcdefghjk" }], error: null });
    await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(avisarNovoAgendamento.mock.calls).toEqual([["i1", false], ["i2", true]]);
  });

  it("falha no aviso nunca derruba a inscrição", async () => {
    rpc.mockResolvedValue({ data: [{ resultado: "nova", inscricao_id: "i1", codigo: "abcdefghjk" }], error: null });
    avisarNovoAgendamento.mockRejectedValue(new Error("banco"));
    expect((await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" })).status).toBe(200);
  });
});

async function post(corpo: unknown) {
  const { POST } = await import("@/app/api/agendamento/[agenda]/inscrever/route");
  return POST(new Request("http://x", { method: "POST", body: JSON.stringify(corpo) }), { params: Promise.resolve({ agenda: "vendas" }) });
}

describe("POST /api/agendamento/[agenda]/inscrever", () => {
  it("agenda e devolve link pessoal e Google Agenda", async () => {
    rpc.mockResolvedValue({ data: [{ resultado: "nova", inscricao_id: "i1", codigo: "abcdefghjk" }], error: null });
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.link).toBe("https://call.exemplo.com.br/c/abcdefghjk");
    expect(j.fim).toBe("2026-10-27T13:00:00.000Z");
    expect(j.googleAgenda).toContain("calendar.google.com");
    expect(rpc).toHaveBeenCalledWith("inscrever", expect.objectContaining({ p_whatsapp: "+551137654321", p_origem: "pagina" }));
  });
  it("lotada vira 409", async () => {
    rpc.mockResolvedValue({ data: [{ resultado: "lotada", inscricao_id: null, codigo: null }], error: null });
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(409);
    expect((await r.json()).resultado).toBe("lotada");
  });
  it("sessão de outra agenda vira 409 sem chamar o banco", async () => {
    tabelas.sessoes = { id: SESSAO, inicio: "2026-10-27T12:00:00Z", agenda_id: "outra" };
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("dado inválido vira 400", async () => {
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1" });
    expect(r.status).toBe(400);
  });
  it("mesma devolve 200 sem código, link ou Google Agenda (não dá pra puxar o lead só sabendo o WhatsApp)", async () => {
    rpc.mockResolvedValue({ data: [{ resultado: "mesma", inscricao_id: "i1", codigo: "abcdefghjk" }], error: null });
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toEqual({ resultado: "mesma", inicio: "2026-10-27T12:00:00.000Z", fim: "2026-10-27T13:00:00.000Z" });
    expect(j.codigo).toBeUndefined();
    expect(j.link).toBeUndefined();
    expect(j.googleAgenda).toBeUndefined();
  });
  it("limite por WhatsApp estourado vira 429", async () => {
    dentroDoLimite.mockImplementation(async (chave: string) => !chave.startsWith("inscrever-wa:"));
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("colisão de código (23505 na constraint do código) tenta de novo com outro código e segue", async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "inscricoes_codigo_key"' } })
      .mockResolvedValueOnce({ data: [{ resultado: "nova", inscricao_id: "i1", codigo: "zzzzzzzzzz" }], error: null });
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(2);
    const [primeiro, segundo] = rpc.mock.calls;
    expect(primeiro[1].p_codigo).not.toBe(segundo[1].p_codigo);
  });
  it("23505 em outra constraint (não é colisão de código) não tenta de novo e vira 500", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "inscricoes_uma_ativa_por_agenda"' },
    });
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(500);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("resultado vazio da RPC vira 500", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(500);
  });
});

describe("inscrever: evento agendou", () => {
  it("nova enfileira agendou com o id da inscrição", async () => {
    rpc.mockResolvedValue({ data: [{ resultado: "nova", inscricao_id: "i1", codigo: "abcdefghjk" }], error: null });
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(200);
    expect(enfileirar).toHaveBeenCalledWith("agendou", "i1");
  });
  it("reagendada enfileira agendou de novo (sessão nova)", async () => {
    rpc.mockResolvedValue({ data: [{ resultado: "reagendada", inscricao_id: "i1", codigo: "abcdefghjk" }], error: null });
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(200);
    expect(enfileirar).toHaveBeenCalledWith("agendou", "i1");
  });
  it("mesma, lotada e indisponivel não enfileiram nada", async () => {
    for (const resultado of ["mesma", "lotada", "indisponivel"]) {
      rpc.mockResolvedValue({ data: [{ resultado, inscricao_id: resultado === "mesma" ? "i1" : null, codigo: null }], error: null });
      await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    }
    expect(enfileirar).not.toHaveBeenCalled();
  });
  it("falha ao enfileirar não muda a resposta e loga sem dado pessoal", async () => {
    rpc.mockResolvedValue({ data: [{ resultado: "nova", inscricao_id: "i1", codigo: "abcdefghjk" }], error: null });
    enfileirar.mockRejectedValue(new Error("Inscrição não encontrada."));
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(200);
    expect((await r.json()).link).toBe("https://call.exemplo.com.br/c/abcdefghjk");
    expect(erro).toHaveBeenCalledWith("[crm] não enfileirou agendou", "Inscrição não encontrada.");
    const logado = JSON.stringify(erro.mock.calls);
    expect(logado).not.toContain("abcdefghjk");
    expect(logado).not.toContain("Maria");
    expect(logado).not.toContain("987654321");
    erro.mockRestore();
  });
});

describe("inscrever: janela de agendamento da agenda", () => {
  // Sábado 24/10/2026, 12h em Brasília: com janela de 2 dias, abrem segunda (26) e terça (27); quarta (28) não.
  const AGORA = new Date("2026-10-24T15:00:00Z");
  const QUARTA = "9b9f2d9e-2b1c-4c55-9f0a-0f6a3b7f1d22";
  const vitrine = [
    { id: "seg", inicio: "2026-10-26T13:00:00Z", vagas: 10, inscritos: 0, status: "agendada" },
    { id: SESSAO, inicio: "2026-10-27T12:00:00Z", vagas: 10, inscritos: 0, status: "agendada" },
    { id: QUARTA, inicio: "2026-10-28T13:00:00Z", vagas: 10, inscritos: 0, status: "agendada" },
  ];
  function rpcCom(resultado: string) {
    rpc.mockImplementation(async (nome: string) =>
      nome === "vitrine_agenda"
        ? { data: vitrine, error: null }
        : { data: [{ resultado, inscricao_id: "i1", codigo: "abcdefghjk" }], error: null },
    );
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
  });
  afterEach(() => vi.useRealTimers());

  it("sessão de dia ainda fechado vira 409 com a mensagem e não chama inscrever", async () => {
    tabelas.agendas = { id: "ag1", titulo_publico: "Call", duracao_min: 60, janela_dias: 2 };
    tabelas.sessoes = { id: QUARTA, inicio: "2026-10-28T13:00:00Z", agenda_id: "ag1" };
    rpcCom("nova");
    const r = await post({ sessao: QUARTA, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erro: "Esse horário ainda não está aberto pra agendamento.", resultado: "fora_da_janela" });
    expect(rpc).toHaveBeenCalledWith("vitrine_agenda", { p_slug: "vendas" });
    expect(rpc).not.toHaveBeenCalledWith("inscrever", expect.anything());
  });

  it("sessão dentro da janela agenda normalmente (vale pro reagendamento também)", async () => {
    tabelas.agendas = { id: "ag1", titulo_publico: "Call", duracao_min: 60, janela_dias: 2 };
    rpcCom("reagendada");
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("inscrever", expect.objectContaining({ p_sessao: SESSAO }));
  });

  it("sem janela (null) não consulta a vitrine", async () => {
    tabelas.agendas = { id: "ag1", titulo_publico: "Call", duracao_min: 60, janela_dias: null };
    rpcCom("nova");
    expect((await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" })).status).toBe(200);
    expect(rpc).not.toHaveBeenCalledWith("vitrine_agenda", expect.anything());
  });

  it("erro ao ler a vitrine vira 500 sem inscrever", async () => {
    tabelas.agendas = { id: "ag1", titulo_publico: "Call", duracao_min: 60, janela_dias: 2 };
    rpc.mockImplementation(async (nome: string) => (nome === "vitrine_agenda" ? { data: null, error: { message: "x" } } : { data: [], error: null }));
    const r = await post({ sessao: SESSAO, nome: "Maria", whatsapp: "1137654321" });
    expect(r.status).toBe(500);
    expect(rpc).not.toHaveBeenCalledWith("inscrever", expect.anything());
  });
});
