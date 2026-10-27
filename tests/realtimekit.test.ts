import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BASE = "https://api.cloudflare.com/client/v4/accounts/acc/realtime/kit/app";
let chamadas: { url: string; init: RequestInit }[] = [];
let respostas: { status: number; corpo: unknown }[] = [];

beforeEach(() => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
  process.env.CLOUDFLARE_API_TOKEN = "tok";
  process.env.REALTIMEKIT_APP_ID = "app";
  chamadas = [];
  respostas = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    const r = respostas.shift() ?? { status: 200, corpo: { success: true, data: {} } };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("realtimekit", () => {
  it("cria meeting com título, sem gravar sozinha", async () => {
    const { criarMeeting } = await import("@/src/lib/realtimekit");
    respostas.push({ status: 201, corpo: { success: true, data: { id: "m1" } } });
    expect(await criarMeeting({ titulo: "Call" })).toEqual({ id: "m1" });
    expect(chamadas[0].url).toBe(`${BASE}/meetings`);
    expect(chamadas[0].init.method).toBe("POST");
    expect((chamadas[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(chamadas[0].init.body as string)).toEqual({ title: "Call", record_on_start: false, persist_chat: true, session_keep_alive_time_in_secs: 600 });
  });

  it("com transcrever: transcrição em português (pt) ao vivo e no fim, sem o resumo da Cloudflare", async () => {
    const { criarMeeting } = await import("@/src/lib/realtimekit");
    const antes = process.env.TRANSCRICAO_PALAVRAS;
    process.env.TRANSCRICAO_PALAVRAS = " Sua Empresa, Ana Souza ,, ";
    respostas.push({ status: 201, corpo: { success: true, data: { id: "m2" } } });
    expect(await criarMeeting({ titulo: "Diagnóstico", transcrever: true })).toEqual({ id: "m2" });
    expect(JSON.parse(chamadas[0].init.body as string)).toEqual({
      title: "Diagnóstico", record_on_start: false, persist_chat: true, session_keep_alive_time_in_secs: 600,
      transcribe_on_end: true, summarize_on_end: false,
      ai_config: { transcription: { language: "pt", keywords: ["Sua Empresa", "Ana Souza"], profanity_filter: false } },
    });
    if (antes === undefined) delete process.env.TRANSCRICAO_PALAVRAS;
    else process.env.TRANSCRICAO_PALAVRAS = antes;
  });

  it("com transcrever e sem TRANSCRICAO_PALAVRAS: vai sem lista de palavras", async () => {
    const { criarMeeting } = await import("@/src/lib/realtimekit");
    const antes = process.env.TRANSCRICAO_PALAVRAS;
    delete process.env.TRANSCRICAO_PALAVRAS;
    respostas.push({ status: 201, corpo: { success: true, data: { id: "m3" } } });
    await criarMeeting({ titulo: "Diagnóstico", transcrever: true });
    expect(JSON.parse(chamadas[0].init.body as string).ai_config).toEqual({ transcription: { language: "pt", profanity_filter: false } });
    if (antes !== undefined) process.env.TRANSCRICAO_PALAVRAS = antes;
  });

  it("adiciona participante e devolve só id e token", async () => {
    const { adicionarParticipante } = await import("@/src/lib/realtimekit");
    respostas.push({ status: 201, corpo: { success: true, data: { id: "p1", token: "jwt", name: "Ana", preset_name: "x" } } });
    expect(await adicionarParticipante("m1", { nome: "Ana", preset: "vortex_convidado", customId: "i1" })).toEqual({ id: "p1", token: "jwt" });
    expect(chamadas[0].url).toBe(`${BASE}/meetings/m1/participants`);
    expect(JSON.parse(chamadas[0].init.body as string)).toEqual({ name: "Ana", preset_name: "vortex_convidado", custom_participant_id: "i1" });
  });

  it("expulsar sem sessão ativa (404) não é erro", async () => {
    const { expulsar } = await import("@/src/lib/realtimekit");
    respostas.push({ status: 404, corpo: { success: false, errors: [{ message: "no active session" }] } });
    await expect(expulsar("m1", ["i1"])).resolves.toBeUndefined();
    expect(chamadas[0].url).toBe(`${BASE}/meetings/m1/active-session/kick`);
    expect(JSON.parse(chamadas[0].init.body as string)).toEqual({ custom_participant_ids: ["i1"] });
  });

  it("outros erros viram ErroRtk com status", async () => {
    const { adicionarParticipante, ErroRtk } = await import("@/src/lib/realtimekit");
    respostas.push({ status: 401, corpo: { success: false } });
    await expect(adicionarParticipante("m1", { nome: "A", preset: "p", customId: "c" })).rejects.toBeInstanceOf(ErroRtk);
  });

  it("expulsar com 400 ou 422 só avisa no console e resolve", async () => {
    const { expulsar, expulsarTodos } = await import("@/src/lib/realtimekit");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    respostas.push({ status: 400, corpo: { success: false } }, { status: 422, corpo: { success: false } });
    await expect(expulsar("m1", ["i1"])).resolves.toBeUndefined();
    await expect(expulsarTodos("m1")).resolves.toBeUndefined();
    expect(aviso).toHaveBeenCalledWith("[rtk] kick ignorado", 400);
    expect(aviso).toHaveBeenCalledWith("[rtk] kick ignorado", 422);
    aviso.mockRestore();
  });

  it("expulsar com 500 rejeita com ErroRtk", async () => {
    const { expulsar, expulsarTodos, ErroRtk } = await import("@/src/lib/realtimekit");
    respostas.push({ status: 500, corpo: {} }, { status: 503, corpo: {} });
    await expect(expulsar("m1", ["i1"])).rejects.toBeInstanceOf(ErroRtk);
    await expect(expulsarTodos("m1")).rejects.toBeInstanceOf(ErroRtk);
  });

  it("expulsar com falha de rede rejeita", async () => {
    const { expulsar } = await import("@/src/lib/realtimekit");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(expulsar("m1", ["i1"])).rejects.toThrow("fetch failed");
  });

  it("excluirParticipante faz DELETE no participante e tolera 4xx", async () => {
    const { excluirParticipante } = await import("@/src/lib/realtimekit");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(excluirParticipante("m1", "p0")).resolves.toBeUndefined();
    expect(chamadas[0].url).toBe(`${BASE}/meetings/m1/participants/p0`);
    expect(chamadas[0].init.method).toBe("DELETE");
    respostas.push({ status: 404, corpo: {} }, { status: 409, corpo: {} });
    await expect(excluirParticipante("m1", "p0")).resolves.toBeUndefined();
    await expect(excluirParticipante("m1", "p0")).resolves.toBeUndefined();
    respostas.push({ status: 502, corpo: {} });
    await expect(excluirParticipante("m1", "p0")).rejects.toThrow();
    aviso.mockRestore();
  });

  it("desativarMeeting faz PATCH com status INACTIVE e tolera 4xx", async () => {
    const { desativarMeeting } = await import("@/src/lib/realtimekit");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(desativarMeeting("m1")).resolves.toBeUndefined();
    expect(chamadas[0].url).toBe(`${BASE}/meetings/m1`);
    expect(chamadas[0].init.method).toBe("PATCH");
    expect(JSON.parse(chamadas[0].init.body as string)).toEqual({ status: "INACTIVE" });
    respostas.push({ status: 404, corpo: {} });
    await expect(desativarMeeting("m1")).resolves.toBeUndefined();
    respostas.push({ status: 500, corpo: {} });
    await expect(desativarMeeting("m1")).rejects.toThrow();
    aviso.mockRestore();
  });

  it("linkDaGravacao pede GET /recordings/{id} e devolve url e validade", async () => {
    const { linkDaGravacao } = await import("@/src/lib/realtimekit");
    respostas.push({ status: 200, corpo: { success: true, data: { id: "rec1", status: "UPLOADED", download_url: "https://dl", download_url_expiry: "2026-10-23T16:00:00Z" } } });
    expect(await linkDaGravacao("rec1")).toEqual({ url: "https://dl", expira: "2026-10-23T16:00:00Z" });
    expect(chamadas[0].url).toBe(`${BASE}/recordings/rec1`);
    expect(chamadas[0].init.method).toBe("GET");
  });

  it("linkDaGravacao: sem arquivo ainda ou 404 → null; 500 sobe", async () => {
    const { linkDaGravacao, ErroRtk } = await import("@/src/lib/realtimekit");
    respostas.push({ status: 200, corpo: { success: true, data: { id: "rec1", status: "RECORDING", download_url: null } } });
    expect(await linkDaGravacao("rec1")).toBeNull();
    respostas.push({ status: 404, corpo: {} });
    expect(await linkDaGravacao("rec1")).toBeNull();
    respostas.push({ status: 500, corpo: {} });
    await expect(linkDaGravacao("rec1")).rejects.toBeInstanceOf(ErroRtk);
  });
});
