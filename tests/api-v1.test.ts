import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";

const m = vi.hoisted(() => {
  class ErroRtkFake extends Error {
    constructor(public status: number, public corpo: unknown) {
      super(`RealtimeKit respondeu ${status}`);
    }
  }
  return {
    ErroRtkFake,
    linkDaGravacao: vi.fn(),
    criarReuniao: vi.fn(),
    permissao: { valor: "escrita" as "leitura" | "escrita" | null, usuarioId: "u1" as string | null },
  };
});

vi.mock("@/src/lib/mcp/auth", () => ({
  autenticarChave: async () =>
    m.permissao.valor
      ? { chave: { id: "c1", nome: "Claude", permissao: m.permissao.valor, usuarioId: m.permissao.usuarioId } }
      : Response.json({ erro: "Chave de acesso ausente ou inválida." }, { status: 401 }),
}));
let f: ReturnType<typeof criarDbFalso>;
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => f.db }));
vi.mock("@/src/lib/realtimekit", () => ({ ErroRtk: m.ErroRtkFake, linkDaGravacao: (id: string) => m.linkDaGravacao(id) }));
vi.mock("@/src/lib/reunioes", () => ({ criarReuniao: (...a: unknown[]) => m.criarReuniao(...a) }));

process.env.NEXT_PUBLIC_SITE_URL = "https://call.exemplo.com.br/";

import * as agendas from "@/app/api/v1/agendas/route";
import * as sessoes from "@/app/api/v1/sessoes/route";
import * as cancelar from "@/app/api/v1/sessoes/[id]/cancelar/route";
import * as inscritos from "@/app/api/v1/sessoes/[id]/inscritos/route";
import * as gravacoes from "@/app/api/v1/gravacoes/route";
import * as link from "@/app/api/v1/gravacoes/[id]/link/route";
import * as reunioes from "@/app/api/v1/reunioes/route";

const A1 = "11111111-1111-4111-8111-111111111111";
const S1 = "33333333-3333-4333-8333-333333333333";
const G1 = "fafafafa-fafa-4faf-8faf-fafafafafafa";
const NADA = "00000000-0000-4000-8000-000000000000";
const futuro = (dias: number) => new Date(Date.now() + dias * 86400_000).toISOString();

beforeEach(() => {
  m.permissao.valor = "escrita";
  m.permissao.usuarioId = "u1";
  m.linkDaGravacao.mockReset();
  m.criarReuniao.mockReset();
  f = criarDbFalso({
    agendas: [{ id: A1, nome: "Diagnóstico", slug: "diagnostico", ativa: true, duracao_min: 60, vagas_padrao: 30 }],
    sessoes: [{ id: S1, agenda_id: A1, titulo: null, inicio: futuro(2), vagas: 30, status: "agendada" }],
    inscricoes: [{ id: "i1", sessao_id: S1, agenda_id: A1, nome: "Ana", whatsapp: "+553139990000", email: null, status: "agendado", minutos_na_sala: 0, created_at: "2026-10-20T10:00:00Z" }],
    presencas: [],
    eventos: [],
    gravacoes: [{ id: G1, sessao_id: S1, reuniao_id: null, rtk_recording_id: "rec1", status: "UPLOADED", download_url: "https://velho", duracao_s: 10, iniciada_em: futuro(-1), created_at: futuro(-1) }],
    reunioes: [],
    usuarios: [{ id: "u1", nome: "Gabriel", ativo: true }],
  });
});

const URL_BASE = "https://call.exemplo.com.br/api/v1";
const get = (caminho: string) => new Request(`${URL_BASE}${caminho}`, { headers: { authorization: "Bearer x" } });
const post = (caminho: string, corpo?: unknown) =>
  new Request(`${URL_BASE}${caminho}`, {
    method: "POST",
    headers: { authorization: "Bearer x", "content-type": "application/json" },
    body: corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("autenticação e permissão", () => {
  it("sem chave válida → 401 em todas as rotas, sem tocar no banco", async () => {
    m.permissao.valor = null;
    const respostas = await Promise.all([
      agendas.GET(get("/agendas")),
      sessoes.GET(get("/sessoes")),
      sessoes.POST(post("/sessoes", {})),
      cancelar.POST(post(`/sessoes/${S1}/cancelar`), ctx(S1)),
      inscritos.GET(get(`/sessoes/${S1}/inscritos`), ctx(S1)),
      gravacoes.GET(get("/gravacoes")),
      link.GET(get(`/gravacoes/${G1}/link`), ctx(G1)),
      reunioes.POST(post("/reunioes", {})),
    ]);
    for (const r of respostas) expect(r.status).toBe(401);
    expect(f.chamadas).toEqual([]);
  });
  it("chave de leitura em POST → 403 sem mudar nada", async () => {
    m.permissao.valor = "leitura";
    for (const r of [
      await sessoes.POST(post("/sessoes", { agenda: "diagnostico", inicio: futuro(3) })),
      await cancelar.POST(post(`/sessoes/${S1}/cancelar`), ctx(S1)),
      await reunioes.POST(post("/reunioes", {})),
    ]) {
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ erro: "Esta chave é só de leitura." });
    }
    expect(f.tabelas.sessoes).toHaveLength(1);
    expect(f.tabelas.sessoes[0].status).toBe("agendada");
    expect(m.criarReuniao).not.toHaveBeenCalled();
  });
  it("chave de leitura pode fazer GET", async () => {
    m.permissao.valor = "leitura";
    expect((await agendas.GET(get("/agendas"))).status).toBe(200);
  });
});

describe("GET /api/v1/agendas", () => {
  it("200 com link de agendar sem barra dupla, sem cache", async () => {
    const r = await agendas.GET(get("/agendas"));
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual([
      { id: A1, nome: "Diagnóstico", slug: "diagnostico", ativa: true, duracao_min: 60, vagas_padrao: 30, responsavel: null, link_agendar: "https://call.exemplo.com.br/agendar/diagnostico" },
    ]);
  });
  it("erro de banco → 500 genérico", async () => {
    f.falhar("agendas", "select");
    const r = await agendas.GET(get("/agendas"));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ erro: "Erro interno. Tente de novo." });
  });
});

describe("/api/v1/sessoes", () => {
  it("GET lista os próximos 14 dias", async () => {
    const r = await sessoes.GET(get("/sessoes"));
    expect(r.status).toBe(200);
    const lista = await r.json();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: S1, agenda: "diagnostico", inscritos: 1, status: "agendada" });
  });
  it("GET com ate só data inclui o dia todo e não a meia-noite seguinte", async () => {
    const ini = new Date(f.tabelas.sessoes[0].inicio as string);
    const dia = new Date(ini.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
    const proximaMeiaNoite = new Date(Date.parse(`${dia}T03:00:00Z`) + 86400_000).toISOString();
    f.tabelas.sessoes.push({ id: "s-meia-noite", agenda_id: A1, titulo: null, inicio: proximaMeiaNoite, vagas: 5, status: "agendada" });
    const lista = await (await sessoes.GET(get(`/sessoes?de=${dia}&ate=${dia}`))).json();
    expect(lista.map((s: { id: string }) => s.id)).toEqual([S1]);
  });
  it("GET com data inválida → 422; agenda inexistente → 404", async () => {
    expect((await sessoes.GET(get("/sessoes?de=amanha"))).status).toBe(422);
    expect((await sessoes.GET(get("/sessoes?agenda=nada"))).status).toBe(404);
    expect((await sessoes.GET(get("/sessoes?de=2026-02-30T10:00:00Z"))).status).toBe(422);
  });
  it("POST cria (201) e valida (422)", async () => {
    const ok = await sessoes.POST(post("/sessoes", { agenda: "diagnostico", inicio: futuro(3), vagas: 12 }));
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ agenda: "diagnostico", vagas: 12, inscritos: 0, status: "agendada" });
    const ruim = await sessoes.POST(post("/sessoes", { agenda: "diagnostico", inicio: futuro(-1) }));
    expect(ruim.status).toBe(422);
    expect(await ruim.json()).toEqual({ erro: "Escolha uma data e hora no futuro." });
    expect((await sessoes.POST(post("/sessoes", "{nao json"))).status).toBe(422);
    expect((await sessoes.POST(post("/sessoes", [1]))).status).toBe(422);
  });
  it("POST cancelar: 200, depois 409; id inválido 422; inexistente 404", async () => {
    const r = await cancelar.POST(post(`/sessoes/${S1}/cancelar`), ctx(S1));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: S1, status: "cancelada", inscritos: 0 });
    expect(f.tabelas.inscricoes[0].status).toBe("cancelado");
    expect((await cancelar.POST(post(`/sessoes/${S1}/cancelar`), ctx(S1))).status).toBe(409);
    expect((await cancelar.POST(post("/sessoes/x/cancelar"), ctx("x"))).status).toBe(422);
    expect((await cancelar.POST(post(`/sessoes/${NADA}/cancelar`), ctx(NADA))).status).toBe(404);
  });
  it("GET inscritos: 200; id inválido 422; inexistente 404", async () => {
    const r = await inscritos.GET(get(`/sessoes/${S1}/inscritos`), ctx(S1));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([{ id: "i1", nome: "Ana", whatsapp: "+553139990000", email: null, status: "agendado", minutos_na_sala: 0, presencas: [], avisos: [] }]);
    expect((await inscritos.GET(get("/sessoes/1/inscritos"), ctx("1"))).status).toBe(422);
    expect((await inscritos.GET(get(`/sessoes/${NADA}/inscritos`), ctx(NADA))).status).toBe(404);
  });
});

describe("/api/v1/gravacoes", () => {
  it("GET lista sem download_url", async () => {
    const r = await gravacoes.GET(get("/gravacoes"));
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo).toHaveLength(1);
    expect(corpo[0]).toMatchObject({ id: G1, origem: "sessao", titulo: "Diagnóstico", expirada: false });
    expect(JSON.stringify(corpo)).not.toContain("velho");
    expect((await gravacoes.GET(get("/gravacoes?ate=xx"))).status).toBe(422);
  });
  it("GET link: 200 na hora; 404 sem link; 502 com RealtimeKit fora; 422 id inválido; 404 inexistente", async () => {
    m.linkDaGravacao.mockResolvedValueOnce({ url: "https://novo", expira: null });
    const r = await link.GET(get(`/gravacoes/${G1}/link`), ctx(G1));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ url: "https://novo", expira: null });
    m.linkDaGravacao.mockResolvedValueOnce(null);
    const sem = await link.GET(get(`/gravacoes/${G1}/link`), ctx(G1));
    expect([sem.status, await sem.json()]).toEqual([404, { erro: "Gravação indisponível." }]);
    m.linkDaGravacao.mockRejectedValueOnce(new m.ErroRtkFake(503, null));
    expect((await link.GET(get(`/gravacoes/${G1}/link`), ctx(G1))).status).toBe(502);
    expect((await link.GET(get("/gravacoes/abc/link"), ctx("abc"))).status).toBe(422);
    expect((await link.GET(get(`/gravacoes/${NADA}/link`), ctx(NADA))).status).toBe(404);
  });
});

describe("POST /api/v1/reunioes", () => {
  it("201 com código e link, em nome do dono da chave", async () => {
    m.criarReuniao.mockResolvedValue({ codigo: "abcdefghjk" });
    const r = await reunioes.POST(post("/reunioes", { titulo: "Alinhamento" }));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ codigo: "abcdefghjk", link: "https://call.exemplo.com.br/r/abcdefghjk" });
    expect(m.criarReuniao).toHaveBeenCalledWith({ id: "u1", nome: "Gabriel" }, "Alinhamento");
  });
  it("corpo vazio cria com título padrão; título não texto → 422; chave sem dono → 422", async () => {
    m.criarReuniao.mockResolvedValue({ codigo: "abcdefghjk" });
    expect((await reunioes.POST(post("/reunioes"))).status).toBe(201);
    expect(m.criarReuniao.mock.calls[0][1]).toBeUndefined();
    expect((await reunioes.POST(post("/reunioes", { titulo: 3 }))).status).toBe(422);
    expect((await reunioes.POST(post("/reunioes", { titulo: "x".repeat(201) }))).status).toBe(422);
    m.permissao.usuarioId = null;
    expect((await reunioes.POST(post("/reunioes", {}))).status).toBe(422);
  });
});
