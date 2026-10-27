import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";

const { ErroRtkFake, linkDaGravacao, criarReuniao } = vi.hoisted(() => {
  class ErroRtkFake extends Error {
    constructor(public status: number, public corpo: unknown) {
      super(`RealtimeKit respondeu ${status}`);
    }
  }
  return { ErroRtkFake, linkDaGravacao: vi.fn(), criarReuniao: vi.fn() };
});
vi.mock("@/src/lib/realtimekit", () => ({ ErroRtk: ErroRtkFake, linkDaGravacao: (id: string) => linkDaGravacao(id) }));
vi.mock("@/src/lib/reunioes", () => ({ criarReuniao: (...a: unknown[]) => criarReuniao(...a) }));
const { linkAssinado, acharPorPrefixo, r2 } = vi.hoisted(() => ({ linkAssinado: vi.fn(), acharPorPrefixo: vi.fn(), r2: { ligado: false } }));
vi.mock("@/src/lib/r2", () => ({
  linkAssinado: (...a: unknown[]) => linkAssinado(...a),
  acharPorPrefixo: (...a: unknown[]) => acharPorPrefixo(...a),
  r2Config: () => (r2.ligado ? { accessKeyId: "a", secretAccessKey: "b", bucket: "c" } : null),
}));

import { listarAgendas } from "@/src/lib/api/agendas";
import { cancelarSessao, cancelarSessaoApi, criarSessao, criarSessaoApi, listarSessoes } from "@/src/lib/api/sessoes";
import { listarInscritos } from "@/src/lib/api/inscritos";
import { linkGravacao, listarGravacoes } from "@/src/lib/api/gravacoes";
import { criarReuniaoApi } from "@/src/lib/api/reunioes";
import { ErroApi, lerInstante } from "@/src/lib/api/http";

const AGORA = new Date("2026-10-23T15:00:00Z");
const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const S1 = "33333333-3333-4333-8333-333333333333";
const S2 = "44444444-4444-4444-8444-444444444444";
const S3 = "55555555-5555-4555-8555-555555555555";
const I1 = "66666666-6666-4666-8666-666666666666";
const I2 = "77777777-7777-4777-8777-777777777777";
const R1 = "88888888-8888-4888-8888-888888888888";

function base() {
  return criarDbFalso({
    agendas: [
      { id: A1, nome: "Diagnóstico", slug: "diagnostico", ativa: true, duracao_min: 60, vagas_padrao: 30, roteiro: "segredo", responsavel_id: "u1" },
      { id: A2, nome: "Antiga", slug: "antiga", ativa: false, duracao_min: 30, vagas_padrao: 10 },
    ],
    sessoes: [
      { id: S1, agenda_id: A1, titulo: null, inicio: "2026-10-24T17:00:00.000Z", vagas: 30, status: "agendada" },
      { id: S2, agenda_id: A2, titulo: "Especial", inicio: "2026-10-25T12:00:00.000Z", vagas: 10, status: "agendada", anfitriao_id: "u1" },
      { id: S3, agenda_id: A1, titulo: null, inicio: "2026-11-20T12:00:00.000Z", vagas: 5, status: "agendada" },
    ],
    inscricoes: [
      { id: I1, sessao_id: S1, agenda_id: A1, nome: "Ana", whatsapp: "+553139990000", email: "ana@x.com", status: "agendado", minutos_na_sala: 0, created_at: "2026-10-20T10:00:00Z", respostas: { segredo: 1 } },
      { id: I2, sessao_id: S1, agenda_id: A1, nome: "Bia", whatsapp: "+553139990001", email: null, status: "cancelado", minutos_na_sala: 0, created_at: "2026-10-21T10:00:00Z" },
    ],
    presencas: [
      { id: "p2", inscricao_id: I1, entrou_em: "2026-10-24T17:20:00Z", saiu_em: null },
      { id: "p1", inscricao_id: I1, entrou_em: "2026-10-24T17:00:00Z", saiu_em: "2026-10-24T17:10:00Z" },
    ],
    eventos: [
      { id: "e2", inscricao_id: I1, evento: "lembrete_24h", status: "pendente", created_at: "2026-10-23T17:00:00Z", corpo: {} },
      { id: "e1", inscricao_id: I1, evento: "agendou", status: "enviado", created_at: "2026-10-20T10:00:00Z", corpo: {} },
    ],
    gravacoes: [],
    reunioes: [{ id: R1, codigo: "abcdefghjk", titulo: "Alinhamento" }],
    usuarios: [{ id: "u1", nome: "Gabriel", ativo: true }],
  });
}

let f: ReturnType<typeof base>;
beforeEach(() => {
  f = base();
  linkDaGravacao.mockReset();
  criarReuniao.mockReset();
  linkAssinado.mockReset();
  acharPorPrefixo.mockReset();
  r2.ligado = false;
});

async function erroDe(p: Promise<unknown>): Promise<ErroApi> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroApi) return e;
    throw e;
  }
  throw new Error("esperava ErroApi");
}

describe("lerInstante", () => {
  it("ISO com fuso, local sem fuso (Brasília) e só data", () => {
    expect(lerInstante("2026-10-30T14:00:00Z")?.toISOString()).toBe("2026-10-30T14:00:00.000Z");
    expect(lerInstante("2026-10-30T14:00:00-03:00")?.toISOString()).toBe("2026-10-30T17:00:00.000Z");
    expect(lerInstante("2026-10-30T14:00")?.toISOString()).toBe("2026-10-30T17:00:00.000Z");
    expect(lerInstante("2026-10-30")?.toISOString()).toBe("2026-10-30T03:00:00.000Z");
    expect(lerInstante("2026-10-30", { fimDoDia: true })?.toISOString()).toBe("2026-10-31T02:59:59.999Z");
  });
  it("com segundos e milissegundos, com e sem fuso", () => {
    expect(lerInstante("2026-10-30T14:00:05")?.toISOString()).toBe("2026-10-30T17:00:05.000Z");
    expect(lerInstante("2026-10-30T14:00:05.123")?.toISOString()).toBe("2026-10-30T17:00:05.123Z");
    expect(lerInstante("2026-10-30T14:00:05.123Z")?.toISOString()).toBe("2026-10-30T14:00:05.123Z");
    expect(lerInstante("2026-10-30T14:00:05+01:00")?.toISOString()).toBe("2026-10-30T13:00:05.000Z");
  });
  it("datas impossíveis → null", () => {
    for (const v of ["2026-02-30T10:00:00Z", "2026-02-30T10:00", "2026-02-30", "2026-10-30T24:30:00-03:00", "2026-10-30T14:00:61"]) expect(lerInstante(v), v).toBeNull();
  });
  it("lixo → null", () => {
    for (const v of ["", "ontem", "2026-13-01", "2026-10-30T25:00", 42, null]) expect(lerInstante(v)).toBeNull();
  });
});

describe("listarAgendas", () => {
  it("devolve só os campos públicos, o responsável (vendedor) e o link de agendamento", async () => {
    const r = await listarAgendas(f.db, "https://call.x");
    expect(r).toEqual([
      { id: A2, nome: "Antiga", slug: "antiga", ativa: false, duracao_min: 30, vagas_padrao: 10, responsavel: null, link_agendar: "https://call.x/agendar/antiga" },
      { id: A1, nome: "Diagnóstico", slug: "diagnostico", ativa: true, duracao_min: 60, vagas_padrao: 30, responsavel: "Gabriel", link_agendar: "https://call.x/agendar/diagnostico" },
    ]);
  });
  it("erro do banco sobe", async () => {
    f.falhar("agendas", "select");
    await expect(listarAgendas(f.db, "https://call.x")).rejects.toThrow();
  });
});

describe("listarSessoes", () => {
  it("padrão: de agora até 14 dias, com agenda, texto em Brasília e inscritos sem cancelados", async () => {
    const r = await listarSessoes(f.db, {}, AGORA);
    expect(r.map((s) => s.id)).toEqual([S1, S2]);
    expect(r[0]).toEqual({
      id: S1, agenda: "diagnostico", titulo: null, inicio: "2026-10-24T17:00:00.000Z",
      inicio_texto: "sábado, 24/10 às 14:00", vagas: 30, inscritos: 1, status: "agendada", anfitriao: null,
    });
    expect(r[1].titulo).toBe("Especial");
    expect(r[1].anfitriao).toBe("Gabriel");
  });
  it("filtra por agenda e janela", async () => {
    const r = await listarSessoes(f.db, { agenda: "diagnostico", de: new Date("2026-10-01T00:00:00Z"), ate: new Date("2026-12-01T00:00:00Z") }, AGORA);
    expect(r.map((s) => s.id)).toEqual([S1, S3]);
  });
  it("agenda inexistente → 404; de depois de ate → 422", async () => {
    expect((await erroDe(listarSessoes(f.db, { agenda: "nada" }, AGORA))).status).toBe(404);
    expect((await erroDe(listarSessoes(f.db, { de: new Date("2026-11-01"), ate: new Date("2026-10-01") }, AGORA))).status).toBe(422);
  });
});

describe("criarSessao (compartilhada com o painel)", () => {
  const ok = { agenda_id: A1, inicio: new Date("2026-10-30T17:00:00Z"), vagas: 20, titulo: null };
  it("valida como o painel", async () => {
    expect(await criarSessao(f.db, { ...ok, agenda_id: "" }, AGORA)).toEqual({ erro: "Escolha a agenda.", tipo: "validacao" });
    expect(await criarSessao(f.db, { ...ok, inicio: null }, AGORA)).toEqual({ erro: "Escolha uma data e hora no futuro.", tipo: "validacao" });
    expect(await criarSessao(f.db, { ...ok, inicio: new Date("2026-10-23T14:00:00Z") }, AGORA)).toMatchObject({ tipo: "validacao" });
    expect(await criarSessao(f.db, { ...ok, vagas: 0 }, AGORA)).toEqual({ erro: "Vagas: de 1 a 500.", tipo: "validacao" });
    expect(await criarSessao(f.db, { ...ok, vagas: 501 }, AGORA)).toMatchObject({ tipo: "validacao" });
    expect(await criarSessao(f.db, { ...ok, vagas: 2.5 }, AGORA)).toMatchObject({ tipo: "validacao" });
  });
  it("agenda desativada ou inexistente não aceita sessão", async () => {
    expect(await criarSessao(f.db, { ...ok, agenda_id: A2 }, AGORA)).toEqual({ erro: "Essa agenda não existe ou está desativada.", tipo: "validacao" });
    expect(await criarSessao(f.db, { ...ok, agenda_id: R1 }, AGORA)).toMatchObject({ tipo: "validacao" });
  });
  it("cria e devolve o id; erro de banco vira tipo banco", async () => {
    const r = await criarSessao(f.db, ok, AGORA);
    expect("id" in r && r.id).toBeTruthy();
    expect(f.tabelas.sessoes).toHaveLength(4);
    f.falhar("sessoes", "insert");
    expect(await criarSessao(f.db, ok, AGORA)).toEqual({ erro: "Não deu para criar a sessão.", tipo: "banco" });
  });
});

describe("criarSessaoApi", () => {
  it("por slug, hora local de Brasília, vagas padrão da agenda", async () => {
    const s = await criarSessaoApi(f.db, { agenda: "diagnostico", inicio: "2026-10-30T14:00", titulo: "  Turma A " }, AGORA);
    expect(s).toMatchObject({ agenda: "diagnostico", inicio: "2026-10-30T17:00:00.000Z", vagas: 30, inscritos: 0, status: "agendada", titulo: "Turma A" });
    expect(s.inicio_texto).toBe("sexta-feira, 30/10 às 14:00");
  });
  it("validação → 422", async () => {
    const casos: Record<string, unknown>[] = [
      {},
      { agenda: "antiga", inicio: "2026-10-30T14:00" },
      { agenda: "nada", inicio: "2026-10-30T14:00" },
      { agenda: "diagnostico", inicio: "ontem" },
      { agenda: "diagnostico", inicio: "2026-10-01T14:00" },
      { agenda: "diagnostico", inicio: "2026-10-30T14:00", vagas: 900 },
      { agenda: "diagnostico", inicio: "2026-10-30T14:00", vagas: "10" },
      { agenda: "diagnostico", inicio: "2026-10-30T14:00", titulo: 5 },
      { agenda: "diagnostico", inicio: "2026-10-30T14:00", titulo: "x".repeat(201) },
    ];
    for (const c of casos) expect((await erroDe(criarSessaoApi(f.db, c, AGORA))).status, JSON.stringify(c)).toBe(422);
    expect(f.tabelas.sessoes).toHaveLength(3);
  });
});

describe("cancelarSessao", () => {
  it("só agendada vira cancelada, e as inscrições agendado viram cancelado", async () => {
    expect(await cancelarSessao(f.db, S1)).toBe("ok");
    expect(f.tabelas.sessoes.find((s) => s.id === S1)!.status).toBe("cancelada");
    expect(f.tabelas.inscricoes.map((i) => i.status)).toEqual(["cancelado", "cancelado"]);
    expect(await cancelarSessao(f.db, S1)).toBe("nao_agendada");
    expect(await cancelarSessao(f.db, R1)).toBe("nao_encontrada");
  });
  it("erro de banco sobe", async () => {
    f.falhar("sessoes", "update");
    await expect(cancelarSessao(f.db, S1)).rejects.toThrow("Não deu para cancelar.");
  });
  it("API: 404 inexistente, 409 não agendada, sessão cancelada no sucesso", async () => {
    f.tabelas.sessoes[1].status = "encerrada";
    expect((await erroDe(cancelarSessaoApi(f.db, R1))).status).toBe(404);
    expect((await erroDe(cancelarSessaoApi(f.db, S2))).status).toBe(409);
    const s = await cancelarSessaoApi(f.db, S1);
    expect(s).toMatchObject({ id: S1, status: "cancelada", inscritos: 0 });
  });
});

describe("listarInscritos", () => {
  it("lista com presenças e avisos em ordem, sem respostas", async () => {
    const r = await listarInscritos(f.db, S1);
    expect(r).toEqual([
      {
        id: I1, nome: "Ana", whatsapp: "+553139990000", email: "ana@x.com", status: "agendado", minutos_na_sala: 0,
        presencas: [
          { entrou_em: "2026-10-24T17:00:00Z", saiu_em: "2026-10-24T17:10:00Z" },
          { entrou_em: "2026-10-24T17:20:00Z", saiu_em: null },
        ],
        avisos: [{ evento: "agendou", status: "enviado" }, { evento: "lembrete_24h", status: "pendente" }],
      },
      { id: I2, nome: "Bia", whatsapp: "+553139990001", email: null, status: "cancelado", minutos_na_sala: 0, presencas: [], avisos: [] },
    ]);
  });
  it("sessão inexistente → 404", async () => {
    expect((await erroDe(listarInscritos(f.db, R1))).status).toBe(404);
  });
});

describe("gravações", () => {
  beforeEach(() => {
    f.tabelas.gravacoes.push(
      { id: "g1", sessao_id: S1, reuniao_id: null, rtk_recording_id: "rec1", status: "UPLOADED", download_url: "https://velho", duracao_s: 1800, iniciada_em: "2026-10-22T10:00:00Z", created_at: "2026-10-22T10:00:01Z" },
      { id: "g2", sessao_id: null, reuniao_id: R1, rtk_recording_id: "rec2", status: "UPLOADED", download_url: null, duracao_s: 60, iniciada_em: null, created_at: "2026-10-23T09:00:00Z" },
      { id: "g3", sessao_id: S2, reuniao_id: null, rtk_recording_id: "rec3", status: "UPLOADED", download_url: null, duracao_s: 60, iniciada_em: "2026-10-10T10:00:00Z", created_at: "2026-10-10T10:00:00Z" },
    );
  });
  it("lista dos últimos 7 dias, mais nova primeiro, sem download_url, com disponível até", async () => {
    const r = await listarGravacoes(f.db, {}, AGORA);
    expect(r).toEqual([
      { id: "g2", origem: "reuniao", titulo: "Alinhamento", iniciada_em: null, duracao_s: 60, status: "UPLOADED", armazenamento: "cloudflare", disponivel_ate: "2026-10-30T09:00:00.000Z", expirada: false },
      { id: "g1", origem: "sessao", titulo: "Diagnóstico", iniciada_em: "2026-10-22T10:00:00Z", duracao_s: 1800, status: "UPLOADED", armazenamento: "cloudflare", disponivel_ate: "2026-10-29T10:00:00.000Z", expirada: false },
    ]);
    expect(JSON.stringify(r)).not.toContain("velho");
  });
  it("janela pedida mostra a expirada marcada; título da sessão vence o nome da agenda", async () => {
    const r = await listarGravacoes(f.db, { de: new Date("2026-10-01T00:00:00Z"), ate: AGORA }, AGORA);
    const g3 = r.find((g) => g.id === "g3")!;
    expect(g3).toMatchObject({ titulo: "Especial", expirada: true, disponivel_ate: "2026-10-17T10:00:00.000Z" });
    expect((await erroDe(listarGravacoes(f.db, { de: AGORA, ate: new Date("2026-10-01") }, AGORA))).status).toBe(422);
  });
  it("link: pede na hora ao RealtimeKit", async () => {
    linkDaGravacao.mockResolvedValue({ url: "https://novo", expira: "2026-10-23T16:00:00Z" });
    expect(await linkGravacao(f.db, "g1", AGORA)).toEqual({ url: "https://novo", expira: "2026-10-23T16:00:00Z" });
    expect(linkDaGravacao).toHaveBeenCalledWith("rec1");
  });
  it("link: inexistente/expirada/sem link no RTK → 404; RTK 404 → 404; outro erro → 502", async () => {
    expect((await erroDe(linkGravacao(f.db, "nada", AGORA))).status).toBe(404);
    const exp = await erroDe(linkGravacao(f.db, "g3", AGORA));
    expect([exp.status, exp.message]).toEqual([404, "Gravação indisponível."]);
    expect(linkDaGravacao).not.toHaveBeenCalled();
    linkDaGravacao.mockResolvedValueOnce(null);
    expect((await erroDe(linkGravacao(f.db, "g1", AGORA))).message).toBe("Gravação indisponível.");
    linkDaGravacao.mockRejectedValueOnce(new ErroRtkFake(404, null));
    expect((await erroDe(linkGravacao(f.db, "g1", AGORA))).status).toBe(404);
    linkDaGravacao.mockRejectedValueOnce(new ErroRtkFake(500, null));
    expect((await erroDe(linkGravacao(f.db, "g1", AGORA))).status).toBe(502);
  });
  it("no R2: sem prazo na lista e link assinado (com baixar), sem chamar o RealtimeKit", async () => {
    f.tabelas.gravacoes.push({ id: "g4", sessao_id: S1, reuniao_id: null, rtk_recording_id: "rec4", status: "UPLOADED", download_url: null, duracao_s: 60, iniciada_em: "2026-10-01T10:00:00Z", created_at: "2026-10-01T10:00:00Z", r2_chave: "gravacoes/s_x.mp4" });
    const r = await listarGravacoes(f.db, { de: new Date("2026-09-01T00:00:00Z"), ate: AGORA }, AGORA);
    expect(r.find((g) => g.id === "g4")).toMatchObject({ armazenamento: "r2", disponivel_ate: null, expirada: false });
    expect(r.find((g) => g.id === "g3")).toMatchObject({ armazenamento: "cloudflare", expirada: true });
    linkAssinado.mockResolvedValue({ url: "https://acc.r2.cloudflarestorage.com/b/gravacoes/s_x.mp4?X-Amz-Signature=1", expira: "2026-10-23T16:00:00Z" });
    expect((await linkGravacao(f.db, "g4", AGORA, { baixar: true })).url).toContain("r2.cloudflarestorage.com");
    expect(linkAssinado).toHaveBeenCalledWith("gravacoes/s_x.mp4", { baixar: true });
    expect(linkDaGravacao).not.toHaveBeenCalled();
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    linkAssinado.mockRejectedValueOnce(new Error("R2 não configurado."));
    expect((await erroDe(linkGravacao(f.db, "g4", AGORA))).status).toBe(502);
    erro.mockRestore();
  });
  it("sem r2_chave mas com prefixo e R2 ligado: procura agora, guarda a chave e assina", async () => {
    r2.ligado = true;
    f.tabelas.gravacoes.push({ id: "g5", sessao_id: S1, reuniao_id: null, rtk_recording_id: "rec5", status: "UPLOADED", download_url: null, duracao_s: 60, iniciada_em: "2026-10-22T10:00:00Z", created_at: "2026-10-22T10:00:00Z", r2_chave: null, r2_prefixo: "s_x_1" });
    acharPorPrefixo.mockResolvedValue("gravacoes/s_x_1_sala.mp4");
    linkAssinado.mockResolvedValue({ url: "https://acc.r2.cloudflarestorage.com/b/gravacoes/s_x_1_sala.mp4?X-Amz-Signature=1", expira: "x" });
    expect((await linkGravacao(f.db, "g5", AGORA)).url).toContain("r2.cloudflarestorage.com");
    expect(acharPorPrefixo).toHaveBeenCalledWith("gravacoes/s_x_1");
    expect(f.tabelas.gravacoes.find((g) => g.id === "g5")?.r2_chave).toBe("gravacoes/s_x_1_sala.mp4");
    expect(linkDaGravacao).not.toHaveBeenCalled();
  });
  it("prefixo sem arquivo ainda, R2 desligado ou sem prefixo: cai no link do RealtimeKit", async () => {
    f.tabelas.gravacoes.push({ id: "g6", sessao_id: S1, reuniao_id: null, rtk_recording_id: "rec6", status: "UPLOADED", download_url: null, duracao_s: 60, iniciada_em: "2026-10-22T10:00:00Z", created_at: "2026-10-22T10:00:00Z", r2_chave: null, r2_prefixo: "s_x_2" });
    linkDaGravacao.mockResolvedValue({ url: "https://rtk", expira: null });
    expect((await linkGravacao(f.db, "g6", AGORA)).url).toBe("https://rtk");
    expect(acharPorPrefixo).not.toHaveBeenCalled();
    r2.ligado = true;
    acharPorPrefixo.mockResolvedValue(null);
    expect((await linkGravacao(f.db, "g6", AGORA)).url).toBe("https://rtk");
    expect((await linkGravacao(f.db, "g1", AGORA)).url).toBe("https://rtk");
    expect(acharPorPrefixo).toHaveBeenCalledTimes(1);
    expect(f.tabelas.gravacoes.find((g) => g.id === "g6")?.r2_chave).toBeNull();
  });
});

describe("criarReuniaoApi", () => {
  it("cria em nome do dono da chave e devolve código e link", async () => {
    criarReuniao.mockResolvedValue({ codigo: "abcdefghjk" });
    expect(await criarReuniaoApi(f.db, "u1", "Call", "https://call.x")).toEqual({ codigo: "abcdefghjk", link: "https://call.x/r/abcdefghjk" });
    expect(criarReuniao).toHaveBeenCalledWith({ id: "u1", nome: "Gabriel" }, "Call");
  });
  it("chave sem dono (ou dono apagado) → 422; RTK fora → 502", async () => {
    expect((await erroDe(criarReuniaoApi(f.db, null, undefined, "https://call.x"))).status).toBe(422);
    expect((await erroDe(criarReuniaoApi(f.db, "u9", undefined, "https://call.x"))).status).toBe(422);
    expect((await erroDe(criarReuniaoApi(f.db, "u1", 3, "https://call.x"))).status).toBe(422);
    expect((await erroDe(criarReuniaoApi(f.db, "u1", "x".repeat(201), "https://call.x"))).status).toBe(422);
    expect(criarReuniao).not.toHaveBeenCalled();
    criarReuniao.mockResolvedValueOnce({ codigo: "abcdefghjk" });
    await criarReuniaoApi(f.db, "u1", "x".repeat(200), "https://call.x");
    criarReuniao.mockRejectedValue(new ErroRtkFake(500, null));
    expect((await erroDe(criarReuniaoApi(f.db, "u1", undefined, "https://call.x"))).status).toBe(502);
  });
});
