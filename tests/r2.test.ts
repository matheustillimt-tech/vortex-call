import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let chamadas: { url: string; metodo: string; headers: Headers }[] = [];
let respostas: { status: number; corpo: string }[] = [];

beforeEach(() => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
  process.env.R2_ACCESS_KEY_ID = "AKIDTESTE";
  process.env.R2_SECRET_ACCESS_KEY = "segredo-teste";
  process.env.R2_BUCKET = "balde";
  chamadas = [];
  respostas = [];
  vi.stubGlobal("fetch", vi.fn(async (entrada: Request | string, init?: RequestInit) => {
    const req = entrada instanceof Request ? entrada : new Request(entrada, init);
    chamadas.push({ url: req.url, metodo: req.method, headers: req.headers });
    const r = respostas.shift() ?? { status: 200, corpo: "" };
    return new Response(r.status === 204 ? null : r.corpo, { status: r.status });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET;
});

describe("r2Config", () => {
  it("null quando falta qualquer variável", async () => {
    const { r2Config } = await import("@/src/lib/r2");
    expect(r2Config()).toEqual({ accessKeyId: "AKIDTESTE", secretAccessKey: "segredo-teste", bucket: "balde" });
    delete process.env.R2_BUCKET;
    expect(r2Config()).toBeNull();
  });
});

describe("linkAssinado", () => {
  it("assina na query por 1 hora, sem chamar a rede", async () => {
    const { linkAssinado } = await import("@/src/lib/r2");
    const { url, expira } = await linkAssinado("gravacoes/s_abc_sala_1.mp4");
    const u = new URL(url);
    expect(u.origin).toBe("https://acc.r2.cloudflarestorage.com");
    expect(u.pathname).toBe("/balde/gravacoes/s_abc_sala_1.mp4");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(u.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(u.searchParams.get("X-Amz-Credential")).toMatch(/^AKIDTESTE\/\d{8}\/auto\/s3\/aws4_request$/);
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(u.searchParams.has("response-content-disposition")).toBe(false);
    expect(url).not.toContain("segredo-teste");
    expect(new Date(expira).getTime()).toBeGreaterThan(Date.now() + 3500_000);
    expect(chamadas).toHaveLength(0);
  });
  it("baixar põe o content-disposition de anexo", async () => {
    const { linkAssinado } = await import("@/src/lib/r2");
    const { url } = await linkAssinado("gravacoes/x.mp4", { baixar: true });
    expect(new URL(url).searchParams.get("response-content-disposition")).toBe("attachment;filename=gravacao.mp4");
  });
  it("sem R2 configurado lança", async () => {
    delete process.env.R2_ACCESS_KEY_ID;
    const { linkAssinado } = await import("@/src/lib/r2");
    await expect(linkAssinado("x")).rejects.toThrow("R2 não configurado.");
  });
});

describe("apagar", () => {
  it("DELETE assinado; 404 não é erro; 500 é", async () => {
    const { apagar } = await import("@/src/lib/r2");
    respostas.push({ status: 204, corpo: "" }, { status: 404, corpo: "" }, { status: 500, corpo: "" }, { status: 500, corpo: "" });
    await apagar("gravacoes/a.mp4");
    expect(chamadas[0].metodo).toBe("DELETE");
    expect(chamadas[0].url).toBe("https://acc.r2.cloudflarestorage.com/balde/gravacoes/a.mp4");
    expect(chamadas[0].headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDTESTE\//);
    await apagar("gravacoes/a.mp4");
    await expect(apagar("gravacoes/a.mp4")).rejects.toThrow("500");
  });
});

describe("acharPorPrefixo", () => {
  const xml = (chaves: string[]) =>
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>balde</Name>${chaves.map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`).join("")}</ListBucketResult>`;

  it("ListObjectsV2 com o prefixo único; prefere a .mp4 ao áudio", async () => {
    const { acharPorPrefixo } = await import("@/src/lib/r2");
    respostas.push({ status: 200, corpo: xml(["gravacoes/s_1_sala_1700000000.mp3", "gravacoes/s_1_sala_1700000000.mp4"]) });
    expect(await acharPorPrefixo("gravacoes/s_1")).toBe("gravacoes/s_1_sala_1700000000.mp4");
    const u = new URL(chamadas[0].url);
    expect(u.pathname).toBe("/balde");
    expect(u.searchParams.get("list-type")).toBe("2");
    expect(u.searchParams.get("prefix")).toBe("gravacoes/s_1");
  });
  it("prefere a chave com o nome do arquivo do webhook", async () => {
    const { acharPorPrefixo } = await import("@/src/lib/r2");
    respostas.push({ status: 200, corpo: xml(["gravacoes/s_1_sala_1.mp4", "gravacoes/s_1_sala_2.mp4"]) });
    expect(await acharPorPrefixo("gravacoes/s_1", "s_1_sala_1.mp4")).toBe("gravacoes/s_1_sala_1.mp4");
  });
  it("vazio → null; erro do R2 lança", async () => {
    const { acharPorPrefixo } = await import("@/src/lib/r2");
    respostas.push({ status: 200, corpo: xml([]) }, { status: 403, corpo: "<Error/>" });
    expect(await acharPorPrefixo("gravacoes/s_1")).toBeNull();
    await expect(acharPorPrefixo("gravacoes/s_1")).rejects.toThrow("403");
  });
});

describe("escolherChave", () => {
  it("sem .mp4 pega a primeira de qualquer tipo", async () => {
    const { escolherChave } = await import("@/src/lib/r2");
    expect(escolherChave(["b.webm", "a.webm"])).toBe("b.webm");
    expect(escolherChave(["a.mp3", "b.mp4", "c.mp4"])).toBe("b.mp4");
    expect(escolherChave([])).toBeNull();
  });
});
