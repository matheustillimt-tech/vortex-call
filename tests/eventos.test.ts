import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const update = vi.fn();
const tabelasUnicas: Record<string, Record<string, unknown> | null> = {};
let listaEventos: Record<string, unknown>[] = [];
let erroUpdate: unknown = null;

function query(tabela: string) {
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: tabelasUnicas[tabela] ?? null }),
    update: (v: unknown) => {
      update(tabela, v);
      return { eq: () => Promise.resolve({ error: erroUpdate }) };
    },
  };
  return q;
}
const from = vi.fn((tabela: string) => query(tabela));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from, rpc }) }));

const SITE = "https://call.exemplo.com.br";
const AGORA = new Date("2026-10-23T12:00:00Z");

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  for (const k of Object.keys(tabelasUnicas)) delete tabelasUnicas[k];
  listaEventos = [];
  erroUpdate = null;
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string) => (fn === "reivindicar_eventos" ? { data: listaEventos, error: null } : { data: null, error: null }));
  update.mockReset();
  from.mockClear();
  vi.unstubAllGlobals();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_TEXT_MODEL;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("enfileirar", () => {
  function base() {
    tabelasUnicas.inscricoes = {
      id: "insc1",
      codigo: "abcdefghjk",
      nome: "Maria Souza",
      whatsapp: "+551137654321",
      email: "maria@x.test",
      sessao_id: "sess1",
      minutos_na_sala: undefined,
    };
    tabelasUnicas.sessoes = { id: "sess1", titulo: "Aula 1", inicio: "2026-10-28T12:00:00Z", agenda_id: "ag1" };
  }

  it("monta o corpo e o id certos e chama a RPC com p_sem_destino false", async () => {
    base();
    tabelasUnicas.agendas = { id: "ag1", slug: "vendas", nome: "Vendas", crm_urls: { agendou: "https://crm.test/hook" } };
    rpc.mockResolvedValue({ data: true, error: null });

    const { enfileirar } = await import("@/src/lib/eventos");
    const r = await enfileirar("agendou", "insc1", AGORA);

    expect(r).toBe(true);
    expect(rpc).toHaveBeenCalledWith("enfileirar_evento", {
      p_id_evento: "agendou:insc1:sess1",
      p_evento: "agendou",
      p_inscricao: "insc1",
      p_sessao: "sess1",
      p_agenda: "ag1",
      p_corpo: expect.objectContaining({ evento: "agendou", id_evento: "agendou:insc1:sess1", link: `${SITE}/c/abcdefghjk` }),
      p_sem_destino: false,
    });
  });

  it("minutos_na_sala informado por quem chama vale no corpo (antes de gravar na inscrição)", async () => {
    base();
    tabelasUnicas.agendas = { id: "ag1", slug: "vendas", nome: "Vendas", crm_urls: {} };
    rpc.mockResolvedValue({ data: true, error: null });

    const { enfileirar } = await import("@/src/lib/eventos");
    await enfileirar("compareceu", "insc1", AGORA, { minutosNaSala: 37 });

    expect(rpc).toHaveBeenCalledWith("enfileirar_evento", expect.objectContaining({ p_corpo: expect.objectContaining({ minutos_na_sala: 37 }) }));
  });

  it("erro da RPC lança (não confunde com evento já existente)", async () => {
    base();
    tabelasUnicas.agendas = { id: "ag1", slug: "vendas", nome: "Vendas", crm_urls: {} };
    rpc.mockResolvedValue({ data: null, error: { message: "fora do ar" } });

    const { enfileirar } = await import("@/src/lib/eventos");
    await expect(enfileirar("agendou", "insc1", AGORA)).rejects.toThrow();
  });

  it("agenda sem URL pro evento manda p_sem_destino true", async () => {
    base();
    tabelasUnicas.agendas = { id: "ag1", slug: "vendas", nome: "Vendas", crm_urls: {} };
    rpc.mockResolvedValue({ data: true, error: null });

    const { enfileirar } = await import("@/src/lib/eventos");
    await enfileirar("agendou", "insc1", AGORA);

    expect(rpc).toHaveBeenCalledWith("enfileirar_evento", expect.objectContaining({ p_sem_destino: true }));
  });

  it("com URL de disparo, enfileira também a linha do disparo (mesmo corpo, id com prefixo)", async () => {
    base();
    tabelasUnicas.agendas = { id: "ag1", slug: "vendas", nome: "Vendas", crm_urls: {}, disparo_url: "https://disparo.test/hook" };
    rpc.mockResolvedValue({ data: true, error: null });

    const { enfileirar } = await import("@/src/lib/eventos");
    await enfileirar("lembrete_1h", "insc1", AGORA);

    expect(rpc).toHaveBeenCalledWith("enfileirar_evento", expect.objectContaining({ p_id_evento: "lembrete_1h:insc1:sess1", p_sem_destino: true }));
    expect(rpc).toHaveBeenCalledWith("enfileirar_evento", expect.objectContaining({
      p_id_evento: "disparo:lembrete_1h:insc1:sess1",
      p_destino: "disparo",
      p_sem_destino: false,
      p_corpo: expect.objectContaining({ id_evento: "lembrete_1h:insc1:sess1" }),
    }));
  });

  it("evento que não vira mensagem (compareceu) não vai pro disparo", async () => {
    base();
    tabelasUnicas.agendas = { id: "ag1", slug: "vendas", nome: "Vendas", crm_urls: {}, disparo_url: "https://disparo.test/hook" };
    rpc.mockResolvedValue({ data: true, error: null });

    const { enfileirar } = await import("@/src/lib/eventos");
    await enfileirar("compareceu", "insc1", AGORA, { minutosNaSala: 10 });

    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("entregarPendentes", () => {
  function evento(sobrescrever: Record<string, unknown> = {}) {
    return {
      id: "e1", id_evento: "agendou:insc1:sess1", evento: "agendou", corpo: { a: 1 }, tentativas: 0,
      agenda_id: "ag1", inscricao_id: "insc1", sessao_id: "sess1", ...sobrescrever,
    };
  }

  beforeEach(() => {
    // Inscrição ainda na sessão do evento e sessão não cancelada: o evento continua valendo.
    tabelasUnicas.inscricoes = { sessao_id: "sess1" };
    tabelasUnicas.sessoes = { status: "agendada" };
  });

  it("usa reivindicar_eventos (lease) em vez de um select simples", async () => {
    listaEventos = [evento()];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));

    const { entregarPendentes } = await import("@/src/lib/eventos");
    await entregarPendentes(AGORA, 50);

    expect(rpc).toHaveBeenCalledWith("reivindicar_eventos", { p_limite: 50, p_agora: AGORA.toISOString() });
  });

  it("linha de disparo vai pra URL de disparo, sem o segredo do CRM", async () => {
    listaEventos = [evento({ destino: "disparo", id_evento: "disparo:agendou:insc1:sess1" })];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: "s3gr3do", disparo_url: "https://disparo.test/hook" };
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { entregarPendentes } = await import("@/src/lib/eventos");
    const r = await entregarPendentes(AGORA);

    expect(r).toEqual({ enviados: 1, falhas: 0 });
    const [url, opcoes] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://disparo.test/hook");
    expect((opcoes.headers as Record<string, string>)["X-Webhook-Secret"]).toBeUndefined();
  });

  it("linha de disparo sem URL de disparo na agenda vira sem_destino (não cai na URL do CRM)", async () => {
    listaEventos = [evento({ destino: "disparo" })];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null, disparo_url: null };
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { entregarPendentes } = await import("@/src/lib/eventos");
    await entregarPendentes(AGORA);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("eventos", { status: "sem_destino" });
  });

  it("2xx marca enviado e guarda a resposta", async () => {
    listaEventos = [evento()];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));

    const { entregarPendentes } = await import("@/src/lib/eventos");
    const r = await entregarPendentes(AGORA);

    expect(r).toEqual({ enviados: 1, falhas: 0 });
    expect(update).toHaveBeenCalledWith(
      "eventos",
      expect.objectContaining({ status: "enviado", resposta_status: 200, resposta: "ok", enviado_em: AGORA.toISOString() }),
    );
  });

  it("resposta 500 soma 1 tentativa e marca próxima em +1 min", async () => {
    listaEventos = [evento({ tentativas: 0 })];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro interno", { status: 500 })));

    const { entregarPendentes } = await import("@/src/lib/eventos");
    const r = await entregarPendentes(AGORA);

    expect(r).toEqual({ enviados: 0, falhas: 1 });
    expect(update).toHaveBeenCalledWith(
      "eventos",
      expect.objectContaining({
        status: "pendente",
        tentativas: 1,
        proxima_em: new Date(AGORA.getTime() + 60_000).toISOString(),
        resposta_status: 500,
      }),
    );
  });

  it("4ª falha vira falhou (sem mais tentativa agendada)", async () => {
    listaEventos = [evento({ tentativas: 3 })];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro", { status: 500 })));

    const { entregarPendentes } = await import("@/src/lib/eventos");
    const r = await entregarPendentes(AGORA);

    expect(r).toEqual({ enviados: 0, falhas: 1 });
    expect(update).toHaveBeenCalledWith("eventos", expect.objectContaining({ status: "falhou", tentativas: 4 }));
    const chamada = update.mock.calls.find((c) => c[0] === "eventos")!;
    expect((chamada[1] as Record<string, unknown>).proxima_em).toBeUndefined();
  });

  it("timeout conta como falha", async () => {
    vi.useFakeTimers();
    listaEventos = [evento()];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, opts: RequestInit) => new Promise((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")));
      })),
    );

    const { entregarPendentes } = await import("@/src/lib/eventos");
    const promessa = entregarPendentes(AGORA);
    await vi.advanceTimersByTimeAsync(5_000);
    const r = await promessa;

    expect(r).toEqual({ enviados: 0, falhas: 1 });
  });

  it("corpo da resposta que trava também cai no tempo limite de 5 s e conta como falha", async () => {
    vi.useFakeTimers();
    listaEventos = [evento({ tentativas: 0 })];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, text: () => new Promise<string>(() => {}) }) as unknown as Response),
    );
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { entregarPendentes } = await import("@/src/lib/eventos");
    let pronto = false;
    const promessa = entregarPendentes(AGORA).then((r) => {
      pronto = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(pronto).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const r = await promessa;

    expect(r).toEqual({ enviados: 0, falhas: 1 });
    expect(update).toHaveBeenCalledWith("eventos", expect.objectContaining({ status: "pendente", tentativas: 1 }));
    expect(update).not.toHaveBeenCalledWith("eventos", expect.objectContaining({ status: "enviado" }));
    aviso.mockRestore();
  });

  it("manda no máximo 5 ao mesmo tempo", async () => {
    listaEventos = Array.from({ length: 12 }, (_, i) => evento({ id: `e${i}`, id_evento: `agendou:insc${i}:sess1` }));
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    let emVoo = 0;
    let maximo = 0;
    const fetchMock = vi.fn(async () => {
      emVoo++;
      maximo = Math.max(maximo, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      emVoo--;
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { entregarPendentes } = await import("@/src/lib/eventos");
    const r = await entregarPendentes(AGORA);

    expect(r).toEqual({ enviados: 12, falhas: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(maximo).toBe(5);
  });

  it("prazo já passado: não começa nenhum envio", async () => {
    listaEventos = [evento()];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    const fetchMock = vi.fn(async (_url: string) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { entregarPendentes } = await import("@/src/lib/eventos");
    const r = await entregarPendentes(AGORA, 50, new Date(Date.now() - 1));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(r).toEqual({ enviados: 0, falhas: 0 });
  });

  it("prazo: depois dele, nenhum POST novo começa (os já começados terminam)", async () => {
    vi.useFakeTimers();
    listaEventos = Array.from({ length: 12 }, (_, i) => evento({ id: `e${i}`, id_evento: `agendou:insc${i}:sess1` }));
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    // Cada POST leva 3 s: 5 começam em 0 s, mais 5 em 3 s (antes do prazo de 4 s); em 6 s o prazo já passou.
    const fetchMock = vi.fn(() => new Promise<Response>((r) => setTimeout(() => r(new Response("ok", { status: 200 })), 3_000)));
    vi.stubGlobal("fetch", fetchMock);

    const { entregarPendentes } = await import("@/src/lib/eventos");
    const promessa = entregarPendentes(AGORA, 50, new Date(Date.now() + 4_000));
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await promessa;

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(r).toEqual({ enviados: 10, falhas: 0 });
  });

  it("inscrição que mudou de sessão: evento obsoleto vira sem_destino sem POST", async () => {
    listaEventos = [evento()];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    tabelasUnicas.inscricoes = { sessao_id: "outra-sessao" };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { entregarPendentes } = await import("@/src/lib/eventos");
    const r = await entregarPendentes(AGORA);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("eventos", { status: "sem_destino", resposta: "obsoleto" });
    expect(r).toEqual({ enviados: 0, falhas: 0 });
  });

  it("sessão cancelada: evento obsoleto vira sem_destino sem POST", async () => {
    listaEventos = [evento()];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    tabelasUnicas.sessoes = { status: "cancelada" };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { entregarPendentes } = await import("@/src/lib/eventos");
    await entregarPendentes(AGORA);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("eventos", { status: "sem_destino", resposta: "obsoleto" });
  });

  it("evento sem sessão (sessão apagada): obsoleto, sem POST", async () => {
    listaEventos = [evento({ sessao_id: null })];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { entregarPendentes } = await import("@/src/lib/eventos");
    await entregarPendentes(AGORA);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("eventos", { status: "sem_destino", resposta: "obsoleto" });
  });

  it("agenda com segredo: X-Webhook-Secret vai e a assinatura confere", async () => {
    listaEventos = [evento({ corpo: { a: 1 } })];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: "s3gredo" };
    const fetchMock = vi.fn(async (_url: string) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { assinarCorpo } = await import("@/src/lib/regras/eventos");
    const { entregarPendentes } = await import("@/src/lib/eventos");
    await entregarPendentes(AGORA);

    const [, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["X-Webhook-Secret"]).toBe("s3gredo");
    expect(headers["X-Vortex-Call-Assinatura"]).toBe(assinarCorpo("s3gredo", String(opts.body)));
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["User-Agent"]).toBe("VortexCall/1");
  });

  it("agenda sem segredo não manda X-Webhook-Secret", async () => {
    listaEventos = [evento()];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    const fetchMock = vi.fn(async (_url: string) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { entregarPendentes } = await import("@/src/lib/eventos");
    await entregarPendentes(AGORA);

    const [, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["X-Webhook-Secret"]).toBeUndefined();
    expect(headers["X-Vortex-Call-Assinatura"]).toBeUndefined();
  });

  it("agenda sem URL pro evento no momento do envio marca sem_destino sem chamar fetch", async () => {
    listaEventos = [evento()];
    tabelasUnicas.agendas = { crm_urls: {}, crm_segredo: null };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { entregarPendentes } = await import("@/src/lib/eventos");
    const r = await entregarPendentes(AGORA);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("eventos", { status: "sem_destino" });
    expect(r).toEqual({ enviados: 0, falhas: 0 });
  });

  it("uma falha não impede a próxima (try/catch por item)", async () => {
    listaEventos = [evento({ id: "e1" }), evento({ id: "e2", id_evento: "agendou:insc2:sess1" })];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    let chamada = 0;
    const fetchMock = vi.fn(async () => {
      chamada++;
      if (chamada === 1) throw new Error("rede caiu");
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { entregarPendentes } = await import("@/src/lib/eventos");
    const r = await entregarPendentes(AGORA);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ enviados: 1, falhas: 1 });
  });

  it("update falha depois de um 2xx: loga erro mas conta como enviado (lease + dedupe do CRM cobrem um reenvio)", async () => {
    listaEventos = [evento()];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    erroUpdate = { message: "falhou" };
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});

    const { entregarPendentes } = await import("@/src/lib/eventos");
    const r = await entregarPendentes(AGORA);

    expect(r).toEqual({ enviados: 1, falhas: 0 });
    expect(erro).toHaveBeenCalledWith("[crm] enviado mas não marcado", "agendou:insc1:sess1");
    erro.mockRestore();
  });

  it("update falha no caminho de erro: loga erro e continua contando como falha", async () => {
    listaEventos = [evento()];
    tabelasUnicas.agendas = { crm_urls: { agendou: "https://crm.test/hook" }, crm_segredo: null };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro", { status: 500 })));
    erroUpdate = { message: "falhou" };
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { entregarPendentes } = await import("@/src/lib/eventos");
    const r = await entregarPendentes(AGORA);

    expect(r).toEqual({ enviados: 0, falhas: 1 });
    expect(erro).toHaveBeenCalledWith("[crm] falha não registrada", "agendou:insc1:sess1");
    erro.mockRestore();
    aviso.mockRestore();
  });

  describe("mensagem pronta (IA ou texto fixo)", () => {
    const LINK = `${SITE}/c/abcdefghjk`;
    const corpoReal = {
      evento: "lembrete_1h",
      id_evento: "lembrete_1h:insc1:sess1",
      agenda: { slug: "vendas", nome: "Vendas" },
      sessao: { id: "sess1", titulo: "Vendas", inicio: "2026-10-28T12:00:00Z", inicio_texto: "quarta-feira, 28/10 às 09:00" },
      lead: { nome: "Maria Souza", primeiro_nome: "Maria", whatsapp: "+551137654321", telefone: "551137654321", email: null },
      link: LINK,
      link_reagendar: `${SITE}/agendar/vendas`,
    };
    const eventoReal = (s: Record<string, unknown> = {}) =>
      evento({ evento: "lembrete_1h", id_evento: "lembrete_1h:insc1:sess1", corpo: corpoReal, mensagem: null, ...s });
    const chamadaCrm = (f: ReturnType<typeof vi.fn>) =>
      (f.mock.calls as unknown as [string, RequestInit][]).find(([u]) => u === "https://crm.test/hook")!;

    beforeEach(() => {
      tabelasUnicas.agendas = { crm_urls: { lembrete_1h: "https://crm.test/hook" }, crm_segredo: null };
      tabelasUnicas.inscricoes = { sessao_id: "sess1", whatsapp: "+551137654321", respostas: null };
    });

    it("sem IA: manda o texto fixo + campos, mantém o resto do corpo e guarda a mensagem", async () => {
      listaEventos = [eventoReal()];
      const fetchMock = vi.fn(async (_url: string) => new Response("ok", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const { mensagemPadrao, dadosDoCorpo } = await import("@/src/lib/regras/mensagem");
      const { entregarPendentes } = await import("@/src/lib/eventos");
      await entregarPendentes(AGORA);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const enviado = JSON.parse(String(chamadaCrm(fetchMock)[1].body));
      const esperado = mensagemPadrao("lembrete_1h", dadosDoCorpo(corpoReal));
      expect(enviado).toEqual({
        ...corpoReal,
        campos: {
          call_agenda: "diagnóstico",
          call_horario: "quarta-feira, 28/10 às 09:00",
          call_link: LINK,
          call_reagendar: `${SITE}/agendar/vendas`,
          call_status: "lembrete",
        },
        mensagem: esperado,
      });
      expect(update).toHaveBeenCalledWith("eventos", expect.objectContaining({ status: "enviado", mensagem: esperado }));
    });

    it("com IA configurada continua indo o texto fixo (a IA não escreve mais os avisos)", async () => {
      process.env.OPENROUTER_API_KEY = "k";
      process.env.OPENROUTER_TEXT_MODEL = "m/1";
      listaEventos = [eventoReal()];
      const fetchMock = vi.fn(async (_url: string) => new Response("ok", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const { entregarPendentes } = await import("@/src/lib/eventos");
      await entregarPendentes(AGORA);

      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("openrouter.ai"))).toBe(false);
      const enviada = JSON.parse(String(chamadaCrm(fetchMock)[1].body)).mensagem;
      expect(enviada).toContain(LINK);
      expect(update).toHaveBeenCalledWith("eventos", expect.objectContaining({ status: "enviado", mensagem: enviada }));
    });

    it("reenvio: mensagem já guardada é reaproveitada, sem chamar a IA", async () => {
      process.env.OPENROUTER_API_KEY = "k";
      process.env.OPENROUTER_TEXT_MODEL = "m/1";
      listaEventos = [eventoReal({ mensagem: "Texto da 1ª tentativa", tentativas: 1 })];
      const fetchMock = vi.fn(async (_url: string) => new Response("ok", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const { entregarPendentes } = await import("@/src/lib/eventos");
      await entregarPendentes(AGORA);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(chamadaCrm(fetchMock)[1].body)).mensagem).toBe("Texto da 1ª tentativa");
    });

    it("falha do CRM guarda a mensagem pra próxima tentativa usar a mesma", async () => {
      listaEventos = [eventoReal()];
      vi.stubGlobal("fetch", vi.fn(async () => new Response("erro", { status: 500 })));
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const { entregarPendentes } = await import("@/src/lib/eventos");
      await entregarPendentes(AGORA);

      expect(update).toHaveBeenCalledWith("eventos", expect.objectContaining({ status: "pendente", mensagem: expect.stringContaining(LINK) }));
    });

    it("compareceu: mensagem vazia", async () => {
      tabelasUnicas.agendas = { crm_urls: { compareceu: "https://crm.test/hook" }, crm_segredo: null };
      listaEventos = [eventoReal({ evento: "compareceu", id_evento: "compareceu:insc1:sess1", corpo: { ...corpoReal, evento: "compareceu", minutos_na_sala: 30 } })];
      const fetchMock = vi.fn(async (_url: string) => new Response("ok", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const { entregarPendentes } = await import("@/src/lib/eventos");
      await entregarPendentes(AGORA);

      const enviado = JSON.parse(String(chamadaCrm(fetchMock)[1].body));
      expect(enviado.mensagem).toBe("");
      expect(enviado.minutos_na_sala).toBe(30);
      expect(enviado.campos.call_status).toBe("compareceu");
    });
  });
});
