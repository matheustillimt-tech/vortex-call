import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contextoDoLead, gerarMensagem } from "@/src/lib/mensagem";
import { mensagemPadrao, type DadosMensagem } from "@/src/lib/regras/mensagem";

const SITE = "https://call.exemplo.com.br";
const DADOS: DadosMensagem = {
  primeiroNome: "Maria",
  agenda: "Diagnóstico",
  inicioTexto: "quarta-feira, 28/10 às 09:00",
  link: `${SITE}/c/abcdefghjk`,
  linkReagendar: `${SITE}/agendar/diagnostico`,
};
const IA = { openrouterKey: "k", modelo: "m/1" };

const conteudo = (texto: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: texto } }] }), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("gerarMensagem", () => {
  it("IA responde certo: usa o texto dela", async () => {
    const texto = `Oi Maria! Falta 1 hora, te espero aqui: ${DADOS.link}`;
    const f = vi.fn(async () => conteudo(JSON.stringify({ mensagem: texto })));
    expect(await gerarMensagem({ evento: "lembrete_1h", dados: DADOS, contexto: "Dona de clínica.", ia: IA, f: f as unknown as typeof fetch })).toBe(texto);
    const corpo = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(corpo.messages[1].content).toContain("Dona de clínica.");
  });

  it("compareceu: vazio, sem chamar a IA", async () => {
    const f = vi.fn();
    expect(await gerarMensagem({ evento: "compareceu", dados: DADOS, contexto: null, ia: IA, f: f as unknown as typeof fetch })).toBe("");
    expect(f).not.toHaveBeenCalled();
  });

  it("sem IA configurada: texto fixo", async () => {
    const f = vi.fn();
    expect(await gerarMensagem({ evento: "faltou", dados: DADOS, contexto: null, ia: null, f: f as unknown as typeof fetch })).toBe(
      mensagemPadrao("faltou", DADOS),
    );
    expect(f).not.toHaveBeenCalled();
  });

  it("IA sem o link exigido: texto fixo", async () => {
    const f = vi.fn(async () => conteudo(JSON.stringify({ mensagem: "Oi Maria, entra lá no link!" })));
    expect(await gerarMensagem({ evento: "comecou", dados: DADOS, contexto: null, ia: IA, f: f as unknown as typeof fetch })).toBe(
      mensagemPadrao("comecou", DADOS),
    );
  });

  it("erro da IA: texto fixo, sem lançar", async () => {
    const f = vi.fn(async () => new Response("x", { status: 500 }));
    expect(await gerarMensagem({ evento: "agendou", dados: DADOS, contexto: null, ia: IA, f: f as unknown as typeof fetch })).toBe(
      mensagemPadrao("agendou", DADOS),
    );
  });

  it("IA travada: texto fixo no tempo limite (8 s)", async () => {
    vi.useFakeTimers();
    const f = vi.fn((_u: string, opts: RequestInit) => new Promise<Response>((_r, rej) => {
      opts.signal?.addEventListener("abort", () => rej(new DOMException("timeout", "AbortError")));
    }));
    let pronto = false;
    const p = gerarMensagem({ evento: "lembrete_24h", dados: DADOS, contexto: null, ia: IA, f: f as unknown as typeof fetch }).then((t) => {
      pronto = true;
      return t;
    });
    await vi.advanceTimersByTimeAsync(7_900);
    expect(pronto).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await p).toBe(mensagemPadrao("lembrete_24h", DADOS));
  });

  it("IA travada com vários modelos: o tempo total continua 8 s", async () => {
    vi.useFakeTimers();
    const f = vi.fn((_u: string, opts: RequestInit) => new Promise<Response>((_r, rej) => {
      opts.signal?.addEventListener("abort", () => rej(new DOMException("timeout", "AbortError")));
    }));
    let pronto = false;
    const p = gerarMensagem({ evento: "lembrete_24h", dados: DADOS, contexto: null, ia: { openrouterKey: "k", modelo: "a/1,b/2,c/3" }, f: f as unknown as typeof fetch }).then(() => {
      pronto = true;
    });
    await vi.advanceTimersByTimeAsync(8_100);
    expect(pronto).toBe(true);
    await p;
  });

  it("tempoMs menor vale (prazo do cron perto)", async () => {
    vi.useFakeTimers();
    const f = vi.fn((_u: string, opts: RequestInit) => new Promise<Response>((_r, rej) => {
      opts.signal?.addEventListener("abort", () => rej(new DOMException("timeout", "AbortError")));
    }));
    let pronto = false;
    const p = gerarMensagem({ evento: "comecou", dados: DADOS, contexto: null, ia: IA, f: f as unknown as typeof fetch, tempoMs: 2_000 }).then(() => {
      pronto = true;
    });
    await vi.advanceTimersByTimeAsync(2_100);
    expect(pronto).toBe(true);
    await p;
  });

  it("tempo curto demais: nem chama a IA", async () => {
    const f = vi.fn();
    expect(await gerarMensagem({ evento: "comecou", dados: DADOS, contexto: null, ia: IA, f: f as unknown as typeof fetch, tempoMs: 500 })).toBe(
      mensagemPadrao("comecou", DADOS),
    );
    expect(f).not.toHaveBeenCalled();
  });
});

describe("contextoDoLead", () => {
  function dbFalso(tabelas: Record<string, Record<string, unknown> | null>) {
    return {
      from: (t: string) => {
        const q: Record<string, unknown> = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: tabelas[t] ?? null }) };
        return q;
      },
    };
  }

  it("usa o resumo salvo da ficha", async () => {
    const db = dbFalso({ inscricoes: { whatsapp: "+5511", respostas: { Profissão: "Dentista" } }, fichas: { resumo_ia: "Dentista que quer escalar." } });
    expect(await contextoDoLead(db as never, "insc1")).toBe("Dentista que quer escalar.");
  });

  it("sem resumo, usa as respostas", async () => {
    const db = dbFalso({ inscricoes: { whatsapp: "+5511", respostas: { Profissão: "Dentista" } }, fichas: null });
    expect(await contextoDoLead(db as never, "insc1")).toContain("Profissão: Dentista");
  });

  it("sem inscrição ou com erro: null, sem lançar", async () => {
    expect(await contextoDoLead(dbFalso({}) as never, "insc1")).toBeNull();
    const quebrado = { from: () => { throw new Error("x"); } };
    expect(await contextoDoLead(quebrado as never, "insc1")).toBeNull();
  });
});
