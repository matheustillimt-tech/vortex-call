import { beforeEach, describe, expect, it, vi } from "vitest";

const lerFicha = vi.fn();
const gerarResumo = vi.fn();
const salvarObservacoes = vi.fn();
vi.mock("@/src/lib/ficha", () => ({
  lerFicha: (...a: unknown[]) => lerFicha(...a),
  gerarResumo: (...a: unknown[]) => gerarResumo(...a),
  salvarObservacoes: (...a: unknown[]) => salvarObservacoes(...a),
}));

// A ficha é lida pela service role (o cliente da equipe não lê o contato do lead), depois das checagens da rota.
const dbFalso = { from: vi.fn() };
type M = { id: string; nome: string; papel: "admin" | "membro"; permissoes?: Record<string, boolean> };
const membroApi = vi.fn<() => Promise<M | null>>(async () => null);
vi.mock("@/src/lib/supabase/usuario", () => ({ membroApi: () => membroApi() }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => dbFalso }));

const podeVerSessao = vi.fn<(quem: unknown, sessao: string) => Promise<boolean>>(async () => true);
vi.mock("@/src/lib/acesso", () => ({ podeVerSessao: (quem: unknown, sessao: string) => podeVerSessao(quem, sessao) }));

let ia: { openrouterKey: string; modelo: string } | null = null;
vi.mock("@/src/lib/env", () => ({ iaConfig: () => ia }));

const S = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const I = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ctx = (sessao = S, inscricao = I) => ({ params: Promise.resolve({ sessao, inscricao }) });
const put = (corpo: unknown) => new Request("http://x", { method: "PUT", body: JSON.stringify(corpo) });

beforeEach(() => {
  lerFicha.mockReset();
  gerarResumo.mockReset();
  salvarObservacoes.mockReset();
  membroApi.mockReset();
  membroApi.mockResolvedValue({ id: "m1", nome: "Gus", papel: "admin" });
  podeVerSessao.mockReset();
  podeVerSessao.mockResolvedValue(true);
  ia = { openrouterKey: "k", modelo: "m" };
});

describe("GET /api/sala/ficha/[sessao]/[inscricao]", () => {
  it("401 sem membro, sem ler nada", async () => {
    membroApi.mockResolvedValue(null);
    const { GET } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/route");
    expect((await GET(new Request("http://x"), ctx())).status).toBe(401);
    expect(lerFicha).not.toHaveBeenCalled();
  });
  it("404 com id que não é uuid", async () => {
    const { GET } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/route");
    expect((await GET(new Request("http://x"), ctx(S, "x"))).status).toBe(404);
    expect(lerFicha).not.toHaveBeenCalled();
  });
  it("404 quando a inscrição não é da sessão", async () => {
    lerFicha.mockResolvedValue(null);
    const { GET } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/route");
    expect((await GET(new Request("http://x"), ctx())).status).toBe(404);
  });
  it("200 com a ficha, lida pela service role depois das checagens", async () => {
    lerFicha.mockResolvedValue({ nome: "Ana" });
    const { GET } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/route");
    const r = await GET(new Request("http://x"), ctx());
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ nome: "Ana" });
    expect(lerFicha).toHaveBeenCalledWith(dbFalso, S, I, undefined);
  });
});

describe("POST .../resumo", () => {
  it("401 sem membro", async () => {
    membroApi.mockResolvedValue(null);
    const { POST } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/resumo/route");
    expect((await POST(new Request("http://x", { method: "POST" }), ctx())).status).toBe(401);
  });
  it("503 com a IA desligada, sem tentar gerar", async () => {
    ia = null;
    const { POST } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/resumo/route");
    const r = await POST(new Request("http://x", { method: "POST" }), ctx());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ erro: "Resumo por IA desligado." });
    expect(gerarResumo).not.toHaveBeenCalled();
  });
  it("404, 502, 200 pronto e 200 sem_dados", async () => {
    const { POST } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/resumo/route");
    gerarResumo.mockResolvedValueOnce(null);
    expect((await POST(new Request("http://x", { method: "POST" }), ctx())).status).toBe(404);
    gerarResumo.mockResolvedValueOnce({ estado: "falhou" });
    const falhou = await POST(new Request("http://x", { method: "POST" }), ctx());
    expect(falhou.status).toBe(502);
    expect(await falhou.json()).toEqual({ erro: "Não deu pra gerar o resumo agora." });
    gerarResumo.mockResolvedValueOnce({ estado: "pronto", texto: "Ana." });
    expect(await (await POST(new Request("http://x", { method: "POST" }), ctx())).json()).toEqual({ estado: "pronto", texto: "Ana." });
    gerarResumo.mockResolvedValueOnce({ estado: "sem_dados" });
    expect(await (await POST(new Request("http://x", { method: "POST" }), ctx())).json()).toEqual({ estado: "sem_dados" });
    expect(gerarResumo).toHaveBeenCalledWith(dbFalso, S, I, ia);
  });
});

describe("PUT .../observacoes", () => {
  it("401 sem membro", async () => {
    membroApi.mockResolvedValue(null);
    const { PUT } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/observacoes/route");
    expect((await PUT(put({ texto: "x" }), ctx())).status).toBe(401);
  });
  it("400 sem texto ou com texto grande demais", async () => {
    const { PUT } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/observacoes/route");
    expect((await PUT(put({}), ctx())).status).toBe(400);
    expect((await PUT(put({ texto: 3 }), ctx())).status).toBe(400);
    expect((await PUT(put({ texto: "a".repeat(10001) }), ctx())).status).toBe(400);
    expect(salvarObservacoes).not.toHaveBeenCalled();
  });
  it("404, 500 e 200", async () => {
    const { PUT } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/observacoes/route");
    salvarObservacoes.mockResolvedValueOnce("nao_encontrada");
    expect((await PUT(put({ texto: "x" }), ctx())).status).toBe(404);
    salvarObservacoes.mockResolvedValueOnce("erro");
    expect((await PUT(put({ texto: "x" }), ctx())).status).toBe(500);
    salvarObservacoes.mockResolvedValueOnce("ok");
    const r = await PUT(put({ texto: "" }), ctx());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(salvarObservacoes).toHaveBeenLastCalledWith(dbFalso, S, I, "", false);
  });
});

describe("ficha: vendedor de outra agenda", () => {
  const OLAVO = { id: "m-olavo", nome: "Olavo", papel: "membro" as const };
  it("404 na ficha, nas observações e no resumo, sem tocar no banco", async () => {
    membroApi.mockResolvedValue(OLAVO);
    podeVerSessao.mockResolvedValue(false);
    const { GET } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/route");
    const { PUT } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/observacoes/route");
    const { POST } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/resumo/route");
    expect((await GET(new Request("http://x"), ctx())).status).toBe(404);
    expect((await PUT(put({ texto: "oi" }), ctx())).status).toBe(404);
    expect((await POST(new Request("http://x", { method: "POST" }), ctx())).status).toBe(404);
    expect(podeVerSessao).toHaveBeenCalledWith(OLAVO, S);
    expect(lerFicha).not.toHaveBeenCalled();
    expect(salvarObservacoes).not.toHaveBeenCalled();
    expect(gerarResumo).not.toHaveBeenCalled();
  });
});

describe("ficha: permissões", () => {
  const HUGO = { id: "m-hugo", nome: "Hugo", papel: "membro" as const };
  const FICHA = {
    inscricaoId: I, nome: "Ana", whatsapp: "+551137654321", linkWhatsapp: "https://wa.me/551137654321", email: "ana@x.com",
    origem: "Página", utm: [], inscritoEm: "x", respostas: [{ pergunta: "Zap", resposta: "(11) 3765-4321" }], anteriores: [],
    resumo: { estado: "sem_dados" }, observacoes: "",
  };

  it("membro: as sessões anteriores ficam só nas agendas dele", async () => {
    membroApi.mockResolvedValue(HUGO);
    lerFicha.mockResolvedValue(FICHA);
    const { GET } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/route");
    expect((await GET(new Request("http://x"), ctx())).status).toBe(200);
    expect(lerFicha).toHaveBeenCalledWith(dbFalso, S, I, HUGO.id);
  });

  it("sem ficha: 403 na ficha, no resumo e nas observações, sem ler nada", async () => {
    membroApi.mockResolvedValue({ ...HUGO, permissoes: { ficha: false } });
    const { GET } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/route");
    const { PUT } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/observacoes/route");
    const { POST } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/resumo/route");
    const r = await GET(new Request("http://x"), ctx());
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erro: "Você não tem permissão pra isso. Fale com o admin." });
    expect((await PUT(put({ texto: "oi" }), ctx())).status).toBe(403);
    expect((await POST(new Request("http://x", { method: "POST" }), ctx())).status).toBe(403);
    expect(lerFicha).not.toHaveBeenCalled();
    expect(salvarObservacoes).not.toHaveBeenCalled();
    expect(gerarResumo).not.toHaveBeenCalled();
  });

  it("sem contato_lead: a ficha chega com WhatsApp e e-mail mascarados, sem link", async () => {
    membroApi.mockResolvedValue({ ...HUGO, permissoes: { contato_lead: false } });
    lerFicha.mockResolvedValue(FICHA);
    const { GET } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/route");
    const r = await GET(new Request("http://x"), ctx());
    const texto = await r.text();
    expect(texto).not.toContain("987654321");
    expect(texto).not.toContain("98765-4321");
    expect(texto).not.toContain("ana@x.com");
    expect(JSON.parse(texto)).toMatchObject({ whatsapp: "+55 11 3••••-4321", email: "a•••@x.com", linkWhatsapp: "", contatoMascarado: true });
  });

  it("admin com contato_lead desligado no jsonb vê tudo", async () => {
    membroApi.mockResolvedValue({ id: "a", nome: "Gus", papel: "admin", permissoes: { contato_lead: false, ficha: false } });
    lerFicha.mockResolvedValue(FICHA);
    const { GET } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/route");
    expect(await (await GET(new Request("http://x"), ctx())).json()).toMatchObject({ whatsapp: "+551137654321" });
  });
});

describe("texto livre sem contato_lead", () => {
  const HUGO = { id: "m-hugo", nome: "Hugo", papel: "membro" as const, permissoes: { contato_lead: false } };
  it("resumo da IA sai mascarado; observações travadas viram 409", async () => {
    membroApi.mockResolvedValue(HUGO);
    gerarResumo.mockResolvedValue({ estado: "pronto", texto: "Retorno no 11 3888-7766 ou ana@x.com." });
    const { POST } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/resumo/route");
    const t = await (await POST(new Request("http://x", { method: "POST" }), ctx())).text();
    expect(t).not.toContain("98888-7766");
    expect(t).not.toContain("ana@x.com");
    salvarObservacoes.mockResolvedValue("travada");
    const { PUT } = await import("@/app/api/sala/ficha/[sessao]/[inscricao]/observacoes/route");
    expect((await PUT(put({ texto: "x" }), ctx())).status).toBe(409);
    expect(salvarObservacoes).toHaveBeenLastCalledWith(dbFalso, S, I, "x", true);
  });
});
