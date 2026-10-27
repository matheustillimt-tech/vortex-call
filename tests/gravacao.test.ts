import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BASE = "https://api.cloudflare.com/client/v4/accounts/acc/realtime/kit/app";
let chamadas: { url: string; init: RequestInit }[] = [];
let respostas: { status: number; corpo: unknown }[] = [];

const insert = vi.fn();
const update = vi.fn();
let erroInsert: { code?: string } | null = null;
let erroUpdate: unknown = null;
vi.mock("@/src/lib/supabase/admin", () => ({
  dbAdmin: () => ({
    from: (tabela: string) => ({
      insert: async (v: unknown) => {
        insert(tabela, v);
        return { error: erroInsert };
      },
      update: (v: unknown) => ({
        eq: async (c: string, val: unknown) => {
          update(tabela, v, c, val);
          return { error: erroUpdate };
        },
      }),
    }),
  }),
}));

beforeEach(() => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
  process.env.CLOUDFLARE_API_TOKEN = "tok";
  process.env.REALTIMEKIT_APP_ID = "app";
  chamadas = [];
  respostas = [];
  insert.mockReset();
  update.mockReset();
  erroInsert = null;
  erroUpdate = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    const r = respostas.shift() ?? { status: 200, corpo: { success: true, data: {} } };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET;
});

describe("prefixos", () => {
  it("único por gravação: s_/r_ + uuid sem hífens + ms; no bucket dentro de gravacoes/", async () => {
    const { prefixoGravacao, prefixoNoBucket } = await import("@/src/lib/gravacao");
    expect(prefixoGravacao("sessao", "11111111-2222-4333-8444-555555555555", 1761230000000)).toBe("s_11111111222243338444555555555555_1761230000000");
    expect(prefixoGravacao("reuniao", "AAAAAAAA-2222-4333-8444-555555555555", 5)).toBe("r_aaaaaaaa222243338444555555555555_5");
    expect(prefixoGravacao("sessao", "1-2")).toMatch(/^s_12_\d{13}$/);
    expect(prefixoNoBucket("s_12_5")).toBe("gravacoes/s_12_5");
  });
});

describe("iniciarGravacao", () => {
  it("com R2: storage_config cloudflare na pasta gravacoes; devolve o id", async () => {
    process.env.R2_ACCESS_KEY_ID = "ak";
    process.env.R2_SECRET_ACCESS_KEY = "sk";
    process.env.R2_BUCKET = "balde";
    respostas.push({ status: 201, corpo: { success: true, data: { id: "rec1", status: "INVOKED" } } });
    const { iniciarGravacao } = await import("@/src/lib/gravacao");
    expect(await iniciarGravacao("m1", "s_abc")).toBe("rec1");
    expect(chamadas[0].url).toBe(`${BASE}/recordings`);
    expect(chamadas[0].init.method).toBe("POST");
    expect(JSON.parse(chamadas[0].init.body as string)).toEqual({
      meeting_id: "m1",
      file_name_prefix: "s_abc",
      storage_config: { type: "cloudflare", access_key: "ak", secret: "sk", bucket: "balde", path: "gravacoes", account_id: "acc" },
    });
  });
  it("sem R2: sem storage_config (fica na Cloudflare)", async () => {
    respostas.push({ status: 201, corpo: { success: true, data: { id: "rec2" } } });
    const { iniciarGravacao } = await import("@/src/lib/gravacao");
    expect(await iniciarGravacao("m1", "r_abc")).toBe("rec2");
    expect(JSON.parse(chamadas[0].init.body as string)).toEqual({ meeting_id: "m1", file_name_prefix: "r_abc" });
  });
  it("erro do RealtimeKit sobe como ErroRtk", async () => {
    respostas.push({ status: 500, corpo: { success: false } });
    const { iniciarGravacao } = await import("@/src/lib/gravacao");
    const { ErroRtk } = await import("@/src/lib/realtimekit");
    await expect(iniciarGravacao("m1", "s_x")).rejects.toBeInstanceOf(ErroRtk);
  });
});

describe("pararGravacao", () => {
  it("acha a ativa e manda stop", async () => {
    respostas.push({ status: 200, corpo: { success: true, data: { id: "rec9", status: "RECORDING" } } }, { status: 200, corpo: { success: true, data: { id: "rec9" } } });
    const { pararGravacao } = await import("@/src/lib/gravacao");
    expect(await pararGravacao("m1")).toBe(true);
    expect(chamadas[0].url).toBe(`${BASE}/recordings/active-recording/m1`);
    expect(chamadas[0].init.method).toBe("GET");
    expect(chamadas[1].url).toBe(`${BASE}/recordings/rec9`);
    expect(chamadas[1].init.method).toBe("PUT");
    expect(JSON.parse(chamadas[1].init.body as string)).toEqual({ action: "stop" });
  });
  it("nada gravando (404 ou sem id) → false, sem PUT", async () => {
    respostas.push({ status: 404, corpo: { success: false } }, { status: 200, corpo: { success: true, data: null } });
    const { pararGravacao } = await import("@/src/lib/gravacao");
    expect(await pararGravacao("m1")).toBe(false);
    expect(await pararGravacao("m1")).toBe(false);
    expect(chamadas).toHaveLength(2);
  });
});

describe("comecarGravacao", () => {
  const SESS = "11111111-2222-4333-8444-555555555555";
  it("começa com prefixo único e registra a gravação com o prefixo", async () => {
    respostas.push({ status: 201, corpo: { success: true, data: { id: "rec7" } } });
    const { comecarGravacao } = await import("@/src/lib/gravacao");
    expect(await comecarGravacao({ tipo: "sessao", id: SESS }, "m1")).toBe("rec7");
    const prefixo = JSON.parse(chamadas[0].init.body as string).file_name_prefix as string;
    expect(prefixo).toMatch(/^s_11111111222243338444555555555555_\d+$/);
    expect(insert).toHaveBeenCalledWith("gravacoes", { rtk_recording_id: "rec7", sessao_id: SESS, reuniao_id: null, status: "RECORDING", r2_prefixo: prefixo });
  });
  it("linha já criada pelo webhook (23505): só completa o r2_prefixo", async () => {
    erroInsert = { code: "23505" };
    respostas.push({ status: 201, corpo: { success: true, data: { id: "rec8" } } });
    const { comecarGravacao } = await import("@/src/lib/gravacao");
    await comecarGravacao({ tipo: "reuniao", id: "r1" }, "m1");
    expect(update).toHaveBeenCalledWith("gravacoes", { r2_prefixo: expect.stringMatching(/^r_r1_\d+$/) }, "rtk_recording_id", "rec8");
  });
  it("RealtimeKit recusou: não registra nada", async () => {
    respostas.push({ status: 409, corpo: {} });
    const { comecarGravacao } = await import("@/src/lib/gravacao");
    await expect(comecarGravacao({ tipo: "sessao", id: SESS }, "m1")).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("gravarAoAbrir", () => {
  const ALVO = { tipo: "sessao" as const, id: "s1" };
  it("tenta de novo em 5xx e 404; para no primeiro sucesso e registra", async () => {
    respostas.push({ status: 500, corpo: {} }, { status: 404, corpo: {} }, { status: 201, corpo: { success: true, data: { id: "rec5" } } });
    const esperas: number[] = [];
    const { gravarAoAbrir } = await import("@/src/lib/gravacao");
    expect(await gravarAoAbrir(ALVO, "m1", [1, 2, 3, 4], async (ms) => void esperas.push(ms))).toBe("rec5");
    expect(esperas).toEqual([1, 2, 3]);
    expect(chamadas).toHaveLength(3);
    expect(insert).toHaveBeenCalledTimes(1);
  });
  it("falha de rede também tenta de novo", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ success: true, data: { id: "rec6" } }), { status: 201 });
    }));
    const { gravarAoAbrir } = await import("@/src/lib/gravacao");
    expect(await gravarAoAbrir(ALVO, "m1", [0, 0], async () => {})).toBe("rec6");
  });
  it.each([401, 403, 409, 422])("%i para na hora: devolve null e loga sem lançar", async (status) => {
    respostas.push({ status, corpo: {} }, { status: 201, corpo: { success: true, data: { id: "nunca" } } });
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { gravarAoAbrir } = await import("@/src/lib/gravacao");
    expect(await gravarAoAbrir(ALVO, "m1", [0, 0], async () => {})).toBeNull();
    expect(chamadas).toHaveLength(1);
    expect(erro).toHaveBeenCalledWith("[gravacao] não começou a gravar sozinha", "m1", status);
    erro.mockRestore();
  });
  it("gravou mas não registrou: devolve o id e só loga", async () => {
    erroInsert = { code: "XX000" };
    respostas.push({ status: 201, corpo: { success: true, data: { id: "rec9" } } });
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { gravarAoAbrir } = await import("@/src/lib/gravacao");
    expect(await gravarAoAbrir(ALVO, "m1", [0], async () => {})).toBe("rec9");
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});
