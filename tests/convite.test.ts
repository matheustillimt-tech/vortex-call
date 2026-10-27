import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";

let falso = criarDbFalso({});
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => falso.db }));

type M = { id: string; nome: string; papel: "admin" | "membro"; permissoes?: Record<string, boolean> } | null;
let membro: M = null;
vi.mock("@/src/lib/supabase/usuario", () => ({
  membroApi: async () => membro,
  exigirMembro: async () => {
    if (!membro) throw new Error("Acesso negado.");
    return membro;
  },
}));

const participanteUnico = vi.fn(async (..._a: unknown[]) => ({ id: "p1", token: "tok" }));
vi.mock("@/src/lib/participantes", () => ({ participanteUnico: (...a: unknown[]) => participanteUnico(...a) }));
const garantirMeeting = vi.fn(async (_s: string) => "m-nova");
vi.mock("@/src/lib/sala", async (original) => ({
  ...(await original<typeof import("@/src/lib/sala")>()),
  garantirMeeting: (s: string) => garantirMeeting(s),
}));
class ErroRtkFake extends Error {}
vi.mock("@/src/lib/realtimekit", () => ({ ErroRtk: ErroRtkFake }));
vi.mock("@/src/lib/disparos", () => ({ enfileirarComecou: async () => 0 }));
vi.mock("@/src/lib/gravacao", () => ({ gravarAoAbrir: async () => null }));

const dentroDoLimite = vi.fn(async (_chave: string, _max: number) => true);
vi.mock("@/src/lib/limite", () => ({ dentroDoLimite: (c: string, m: number) => dentroDoLimite(c, m) }));

process.env.CRYPTO_KEY = "a".repeat(64);
process.env.NEXT_PUBLIC_SITE_URL = "https://call.exemplo.com.br/";

import { gerarConvite, ehConviteValido, situacaoConvite } from "@/src/lib/regras/convite";

const HUGO = { id: "u-hugo", nome: "Hugo", papel: "membro" as const };
const OLAVO = { id: "u-olavo", nome: "Olavo", papel: "membro" as const };
const GABRIEL = { id: "u-gabriel", nome: "Gabriel", papel: "admin" as const };
const SESSAO = "11111111-1111-4111-8111-111111111111";
const SESSAO_FIM = "22222222-2222-4222-8222-222222222222";
const CONVITE = "AbCdEfGhIjKlMnOpQrStUv";
const VISITANTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const agora = () => new Date().toISOString();

beforeEach(() => {
  falso = criarDbFalso({
    agendas: [{ id: "ag-impl", nome: "Implementação de IA", responsavel_id: "u-hugo", duracao_min: 60 }],
    sessoes: [
      { id: SESSAO, agenda_id: "ag-impl", status: "ao_vivo", inicio: agora(), titulo: null, rtk_meeting_id: "m1", vagas: 1 },
      { id: SESSAO_FIM, agenda_id: "ag-impl", status: "encerrada", inicio: agora(), titulo: null, rtk_meeting_id: "m2", vagas: 1 },
    ],
    inscricoes: [{ id: "i1", sessao_id: SESSAO, status: "agendado" }],
    convites_sessao: [],
    eventos: [],
    presencas: [],
  });
  membro = null;
  participanteUnico.mockClear();
  garantirMeeting.mockClear();
  dentroDoLimite.mockReset();
  dentroDoLimite.mockResolvedValue(true);
});

describe("regras do convite", () => {
  it("código url-safe de 22 caracteres, diferente a cada vez", () => {
    const a = gerarConvite();
    const b = gerarConvite();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
    expect(ehConviteValido(a)).toBe(true);
  });

  it("valida o formato", () => {
    for (const c of ["", "curto", "abcdefghjk", `${CONVITE}x`, "AbCdEfGhIjKlMnOpQrSt/v", null, 123]) expect(ehConviteValido(c)).toBe(false);
  });

  it("aberta só ao vivo; agendada aguarda; encerrada, cancelada ou passou do prazo final terminou", () => {
    const inicio = new Date("2026-10-26T12:00:00Z");
    const antes = new Date("2026-10-26T11:00:00Z");
    const depoisDoPrazo = new Date("2026-10-26T15:00:01Z"); // 60 min + 2 h
    expect(situacaoConvite({ status: "ao_vivo", inicio, duracaoMin: 60, agora: antes })).toBe("aberta");
    expect(situacaoConvite({ status: "agendada", inicio, duracaoMin: 60, agora: antes })).toBe("aguardando");
    expect(situacaoConvite({ status: "encerrada", inicio, duracaoMin: 60, agora: antes })).toBe("encerrada");
    expect(situacaoConvite({ status: "cancelada", inicio, duracaoMin: 60, agora: antes })).toBe("encerrada");
    expect(situacaoConvite({ status: "ao_vivo", inicio, duracaoMin: 60, agora: depoisDoPrazo })).toBe("encerrada");
    expect(situacaoConvite({ status: "agendada", inicio, duracaoMin: 60, agora: depoisDoPrazo })).toBe("encerrada");
  });
});

function post(corpo?: unknown) {
  return new Request("http://x", { method: "POST", headers: { "x-forwarded-for": "1.2.3.4" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
}

describe("POST /api/sala/link-convidado/[sessao] (anfitrião pega o link)", () => {
  async function chamar(sessao = SESSAO) {
    const { POST } = await import("@/app/api/sala/link-convidado/[sessao]/route");
    return POST(post(), { params: Promise.resolve({ sessao }) });
  }

  it("sem login: 401 e nada gravado", async () => {
    const r = await chamar();
    expect(r.status).toBe(401);
    expect(falso.tabelas.convites_sessao).toHaveLength(0);
  });

  it("admin: gera o código uma vez e devolve o link de /s/", async () => {
    membro = GABRIEL;
    const r = await chamar();
    expect(r.status).toBe(200);
    const j = (await r.json()) as { link: string };
    expect(j.link).toMatch(/^https:\/\/call\.exemplo\.com\.br\/s\/[A-Za-z0-9_-]{22}$/);
    expect(falso.tabelas.convites_sessao).toHaveLength(1);
    expect(falso.tabelas.convites_sessao[0]).toMatchObject({ sessao_id: SESSAO, criado_por: "u-gabriel" });
    // Segundo clique: mesmo link, nenhum código novo.
    const r2 = await chamar();
    expect(((await r2.json()) as { link: string }).link).toBe(j.link);
    expect(falso.tabelas.convites_sessao).toHaveLength(1);
  });

  it("responsável pela agenda com a permissão anfitrião: ok", async () => {
    membro = HUGO;
    const r = await chamar();
    expect(r.status).toBe(200);
  });

  it("membro só com espião (sem anfitrião): 403", async () => {
    membro = { ...HUGO, permissoes: { anfitriao: false, espiao: true } };
    const r = await chamar();
    expect(r.status).toBe(403);
    expect(falso.tabelas.convites_sessao).toHaveLength(0);
  });

  it("membro de outra agenda: 404, mesmo com todas_agendas", async () => {
    membro = { ...OLAVO, permissoes: { todas_agendas: true } };
    const r = await chamar();
    expect(r.status).toBe(404);
    expect(falso.tabelas.convites_sessao).toHaveLength(0);
  });

  it("sessão encerrada: 409", async () => {
    membro = GABRIEL;
    const r = await chamar(SESSAO_FIM);
    expect(r.status).toBe(409);
    expect(falso.tabelas.convites_sessao).toHaveLength(0);
  });

  it("id que não é uuid ou sessão inexistente: 404", async () => {
    membro = GABRIEL;
    expect((await chamar("nao-e-uuid")).status).toBe(404);
    expect((await chamar("33333333-3333-4333-8333-333333333333")).status).toBe(404);
  });
});

describe("/api/convite/[codigo] (entrada pública do convidado)", () => {
  function comConvite(sessao = SESSAO) {
    falso.tabelas.convites_sessao.push({ sessao_id: sessao, codigo: CONVITE, criado_por: "u-gabriel" });
  }
  async function entrar(corpo: unknown, codigo = CONVITE) {
    const { POST } = await import("@/app/api/convite/[codigo]/route");
    return POST(post(corpo), { params: Promise.resolve({ codigo }) });
  }
  async function estado(codigo = CONVITE) {
    const { GET } = await import("@/app/api/convite/[codigo]/route");
    return GET(new Request("http://x"), { params: Promise.resolve({ codigo }) });
  }

  it("sessão ao vivo: entra como participante, customId convidado:, sem inscrição nem evento nem presença", async () => {
    comConvite();
    const r = await entrar({ nome: "  Celso Sócio ", visitanteId: VISITANTE });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ token: "tok", nome: "Celso Sócio", papel: "participante", transcreve: false });
    const hash = createHash("sha256").update(VISITANTE).digest("hex").slice(0, 32);
    expect(participanteUnico).toHaveBeenCalledWith("m1", { nome: "Celso Sócio", preset: "vortex_participante", customId: `convidado:${hash}` });
    expect(falso.tabelas.inscricoes).toHaveLength(1);
    expect(falso.tabelas.eventos).toHaveLength(0);
    expect(falso.tabelas.presencas).toHaveLength(0);
    expect(falso.chamadas.filter((c) => c.op !== "select")).toEqual([]);
  });

  it("ignora as vagas (sessão cheia ainda deixa entrar)", async () => {
    comConvite();
    const r = await entrar({ nome: "Celso", visitanteId: VISITANTE });
    expect(r.status).toBe(200);
  });

  it("sessão ainda agendada (anfitrião não abriu): 409 aguardando, sem passe", async () => {
    falso.tabelas.sessoes[0].status = "agendada";
    comConvite();
    const r = await entrar({ nome: "Celso", visitanteId: VISITANTE });
    expect(r.status).toBe(409);
    expect((await r.json()).estado).toBe("aguardando");
    expect(participanteUnico).not.toHaveBeenCalled();
  });

  it("sessão encerrada: 409 encerrada", async () => {
    comConvite(SESSAO_FIM);
    const r = await entrar({ nome: "Celso", visitanteId: VISITANTE });
    expect(r.status).toBe(409);
    expect((await r.json()).estado).toBe("encerrada");
    expect(participanteUnico).not.toHaveBeenCalled();
  });

  it("código inexistente ou malformado: 404", async () => {
    expect((await entrar({ nome: "Celso", visitanteId: VISITANTE })).status).toBe(404);
    expect((await entrar({ nome: "Celso", visitanteId: VISITANTE }, "abc")).status).toBe(404);
  });

  it("nome ou id do navegador inválido: 400", async () => {
    comConvite();
    expect((await entrar({ nome: "C", visitanteId: VISITANTE })).status).toBe(400);
    expect((await entrar({ nome: "Celso", visitanteId: "x" })).status).toBe(400);
    expect(participanteUnico).not.toHaveBeenCalled();
  });

  it("limite por IP: 429 sem tocar no RealtimeKit", async () => {
    comConvite();
    dentroDoLimite.mockResolvedValue(false);
    const r = await entrar({ nome: "Celso", visitanteId: VISITANTE });
    expect(r.status).toBe(429);
    expect(dentroDoLimite.mock.calls[0][0]).toMatch(/^convite-entrar:/);
    expect(participanteUnico).not.toHaveBeenCalled();
  });

  it("GET devolve só o estado e o título", async () => {
    comConvite();
    const r = await estado();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: "aberta", titulo: "Implementação de IA" });
    expect((await estado("AAAAAAAAAAAAAAAAAAAAAA")).status).toBe(404);
  });
});

describe("convidado de fora não vira lead", () => {
  it("presença: entrada e saída de convidado: são ignoradas", async () => {
    const { registrarEntrada, registrarSaida } = await import("@/src/lib/presenca");
    const base = { meeting: { id: "m1" }, participant: { peerId: "peer1", customParticipantId: "convidado:abc", joinedAt: agora(), leftAt: agora() } };
    await registrarEntrada(base);
    await registrarSaida(base);
    expect(falso.tabelas.presencas).toHaveLength(0);
  });

  it("coluna da equipe: convidado de fora aparece separado, sem ficha", async () => {
    const { separarPessoas } = await import("@/src/lib/regras/coluna");
    const r = separarPessoas([
      { id: "p1", userId: "u1", nome: "Celso", customId: "convidado:abc" },
      { id: "p2", userId: "u2", nome: "Gus", customId: "membro:m1" },
    ]);
    expect(r.convidados).toEqual([]);
    expect(r.equipe).toEqual(["Gus"]);
    expect(r.externos).toEqual(["Celso"]);
  });
});
