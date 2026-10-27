import { beforeEach, describe, expect, it, vi } from "vitest";
import { completarJson, modelosDe } from "@/src/lib/openrouter";

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const conteudo = (texto: string) => resposta({ choices: [{ message: { content: texto } }] });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://call.exemplo.com/";
});

describe("completarJson (OpenRouter)", () => {
  it("manda cabeçalhos e corpo certos e devolve o JSON", async () => {
    const f = vi.fn(async () => conteudo('{"resumo":"oi"}'));
    const d = await completarJson({ sistema: "sis", usuario: "usu", maxTokens: 400, temperatura: 0.3 }, { openrouterKey: "chave-or", modelo: "m/x" }, f as unknown as typeof fetch);
    expect(d).toEqual({ resumo: "oi" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer chave-or");
    expect(h["HTTP-Referer"]).toBe("https://call.exemplo.com");
    expect(h["X-Title"]).toBe("Vórtex Call");
    const corpo = JSON.parse(String(init.body));
    expect(corpo).toEqual({
      model: "m/x",
      response_format: { type: "json_object" },
      max_tokens: 400,
      temperature: 0.3,
      messages: [{ role: "system", content: "sis" }, { role: "user", content: "usu" }],
    });
  });

  it("modelo principal falha: tenta o de reserva", async () => {
    const f = vi.fn(async () => resposta({ error: "x" }, 500));
    f.mockImplementationOnce(async () => resposta({ error: "x" }, 500)).mockImplementationOnce(async () => conteudo('{"resumo":"ok"}'));
    const d = await completarJson({ sistema: "s", usuario: "u" }, { openrouterKey: "k", modelo: "a/1, b/2" }, f as unknown as typeof fetch);
    expect(d).toEqual({ resumo: "ok" });
    expect(JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).model).toBe("b/2");
  });

  it("erro HTTP vira 'A IA não respondeu.' sem vazar a chave", async () => {
    const f = vi.fn(async () => resposta({ error: "unauthorized" }, 401));
    const e = await completarJson({ sistema: "s", usuario: "u" }, { openrouterKey: "chave-secreta", modelo: "m" }, f as unknown as typeof fetch).catch((x: Error) => x);
    expect((e as Error).message).toBe("A IA não respondeu.");
    expect((e as Error).message).not.toContain("chave-secreta");
  });

  it("JSON com cerca ``` ou texto antes: pega o primeiro {...}", async () => {
    const f = vi.fn(async () => conteudo('Aqui: ```json\n{"resumo":"a {b}"}\n```'));
    expect(await completarJson({ sistema: "s", usuario: "u" }, { openrouterKey: "k", modelo: "m" }, f as unknown as typeof fetch)).toEqual({ resumo: "a {b}" });
  });

  it("conteúdo que não é JSON vira o erro amigável", async () => {
    const f = vi.fn(async () => conteudo("isso não é json"));
    const e = await completarJson({ sistema: "s", usuario: "u" }, { openrouterKey: "k", modelo: "m" }, f as unknown as typeof fetch).catch((x: Error) => x);
    expect((e as Error).message).toBe("A IA não respondeu.");
  });

  it("prazoMs limita o tempo total, somando todos os modelos", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn((_u: string, opts: RequestInit) => new Promise<Response>((_r, rej) => {
        opts.signal?.addEventListener("abort", () => rej(new DOMException("timeout", "AbortError")));
      }));
      vi.spyOn(console, "warn").mockImplementation(() => {});
      let erro: Error | null = null;
      const p = completarJson({ sistema: "s", usuario: "u", prazoMs: 3_000 }, { openrouterKey: "k", modelo: "a/1,b/2" }, f as unknown as typeof fetch).catch((e: Error) => {
        erro = e;
      });
      await vi.advanceTimersByTimeAsync(3_050);
      await p;
      expect(erro).not.toBeNull();
      expect(f).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).not.toHaveProperty("prazoMs");
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("modelosDe separa por vírgula e ignora vazios", () => {
    expect(modelosDe({ openrouterKey: "k", modelo: "a/1, ,b/2," })).toEqual(["a/1", "b/2"]);
  });
});
