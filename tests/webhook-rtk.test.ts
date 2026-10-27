import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function gerarPar(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;
}

async function exportarPem(chavePublica: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey("spki", chavePublica);
  const b64 = Buffer.from(spki).toString("base64");
  const linhas = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN PUBLIC KEY-----\n${linhas}\n-----END PUBLIC KEY-----\n`;
}

async function assinar(chavePrivada: CryptoKey, corpo: ArrayBuffer): Promise<string> {
  const assinatura = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chavePrivada, corpo);
  return Buffer.from(assinatura).toString("base64");
}

function paraArrayBuffer(texto: string): ArrayBuffer {
  return new TextEncoder().encode(texto).buffer as ArrayBuffer;
}

describe("verificarAssinatura", () => {
  it("assinatura certa sobre o corpo certo devolve true", async () => {
    const { publicKey, privateKey } = await gerarPar();
    const pem = await exportarPem(publicKey);
    const corpo = paraArrayBuffer(JSON.stringify({ a: 1 }));
    const assinatura = await assinar(privateKey, corpo);

    const { verificarAssinatura } = await import("@/src/lib/regras/webhook-rtk");
    await expect(verificarAssinatura(pem, assinatura, corpo)).resolves.toBe(true);
  });

  it("corpo alterado depois de assinado devolve false", async () => {
    const { publicKey, privateKey } = await gerarPar();
    const pem = await exportarPem(publicKey);
    const corpo = paraArrayBuffer(JSON.stringify({ a: 1 }));
    const assinatura = await assinar(privateKey, corpo);
    const corpoAlterado = paraArrayBuffer(JSON.stringify({ a: 2 }));

    const { verificarAssinatura } = await import("@/src/lib/regras/webhook-rtk");
    await expect(verificarAssinatura(pem, assinatura, corpoAlterado)).resolves.toBe(false);
  });

  it("assinatura em base64 inválido devolve false sem lançar", async () => {
    const { publicKey } = await gerarPar();
    const pem = await exportarPem(publicKey);
    const corpo = paraArrayBuffer("{}");

    const { verificarAssinatura } = await import("@/src/lib/regras/webhook-rtk");
    await expect(verificarAssinatura(pem, "não é base64 válido!!! ===", corpo)).resolves.toBe(false);
  });
});

// ---- Rota ----

const tabelas: Record<string, Record<string, unknown> | null> = {};
let erroInsercaoWebhook: { code?: string; message?: string } | null = null;
let erroUpsertGravacao: unknown = null;
let erroUpdateSessao: unknown = null;
let erroUpsertPresenca: unknown = null;
let dadosUpdatePresenca: Array<{ id: string }> = [];
const insertWebhook = vi.fn();
const upsertGravacao = vi.fn();
const updateSessao = vi.fn();
const deleteWebhook = vi.fn();
const upsertPresenca = vi.fn();
const updatePresenca = vi.fn();

function consulta(tabela: string) {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: tabelas[tabela] ?? null }),
    insert: (v: unknown) => {
      insertWebhook(tabela, v);
      return Promise.resolve({ error: erroInsercaoWebhook });
    },
    upsert: (v: unknown, opts: unknown) => {
      if (tabela === "presencas") {
        upsertPresenca(v, opts);
        return Promise.resolve({ error: erroUpsertPresenca });
      }
      upsertGravacao(v, opts);
      return Promise.resolve({ error: erroUpsertGravacao });
    },
    update: (v: unknown) => {
      if (tabela === "presencas") {
        updatePresenca(v);
        const q2 = {
          eq: () => q2,
          is: () => q2,
          select: async () => ({ data: dadosUpdatePresenca, error: null }),
        };
        return q2;
      }
      updateSessao(tabela, v);
      return { eq: async () => ({ error: erroUpdateSessao }) };
    },
    delete: () => ({
      eq: async (...a: unknown[]) => {
        deleteWebhook(tabela, ...a);
        return { error: null };
      },
    }),
  };
  return q;
}
const from = vi.fn((tabela: string) => consulta(tabela));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from }) }));

let r2Ligado = false;
const acharPorPrefixo = vi.fn<(prefixo: string, nome?: string | null) => Promise<string | null>>(async () => null);
vi.mock("@/src/lib/r2", () => ({
  r2Config: () => (r2Ligado ? { accessKeyId: "a", secretAccessKey: "b", bucket: "c" } : null),
  acharPorPrefixo: (p: string, n?: string | null) => acharPorPrefixo(p, n),
}));

let PEM_CHAVE_PUBLICA: string;
let CHAVE_PRIVADA: CryptoKey;
let CHAVE_PRIVADA_ERRADA: CryptoKey;

beforeEach(async () => {
  for (const k of Object.keys(tabelas)) delete tabelas[k];
  erroInsercaoWebhook = null;
  erroUpsertGravacao = null;
  erroUpdateSessao = null;
  erroUpsertPresenca = null;
  dadosUpdatePresenca = [];
  insertWebhook.mockReset();
  upsertGravacao.mockReset();
  updateSessao.mockReset();
  deleteWebhook.mockReset();
  upsertPresenca.mockReset();
  updatePresenca.mockReset();
  from.mockClear();
  r2Ligado = false;
  acharPorPrefixo.mockReset();
  acharPorPrefixo.mockResolvedValue(null);

  if (!PEM_CHAVE_PUBLICA) {
    const par = await gerarPar();
    PEM_CHAVE_PUBLICA = await exportarPem(par.publicKey);
    CHAVE_PRIVADA = par.privateKey;
    const parErrada = await gerarPar();
    CHAVE_PRIVADA_ERRADA = parErrada.privateKey;
  }

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { publicKey: PEM_CHAVE_PUBLICA } }),
    })),
  );
});

async function postWebhook(
  payload: unknown,
  opts: { uuid?: string | null; semAssinatura?: boolean; chaveErrada?: boolean } = {},
) {
  const { POST } = await import("@/app/api/webhooks/realtimekit/route");
  const corpo = JSON.stringify(payload);
  const headers = new Headers();
  if (opts.uuid !== null) headers.set("rtk-uuid", opts.uuid ?? "uuid-1");
  if (!opts.semAssinatura) {
    const chave = opts.chaveErrada ? CHAVE_PRIVADA_ERRADA : CHAVE_PRIVADA;
    const assinatura = await assinar(chave, paraArrayBuffer(corpo));
    headers.set("rtk-signature", assinatura);
  }
  const req = new Request("http://x/api/webhooks/realtimekit", { method: "POST", headers, body: corpo });
  return POST(req);
}

/** Variante que manda um corpo bruto (texto) qualquer, assinado de verdade, pra testar corpo que não é JSON
 *  válido (mas passa a verificação de assinatura, que roda sobre o corpo bruto). */
async function postWebhookCorpoBruto(corpoTexto: string) {
  const { POST } = await import("@/app/api/webhooks/realtimekit/route");
  const assinatura = await assinar(CHAVE_PRIVADA, paraArrayBuffer(corpoTexto));
  const headers = new Headers({ "rtk-uuid": "uuid-1", "rtk-signature": assinatura });
  const req = new Request("http://x/api/webhooks/realtimekit", { method: "POST", headers, body: corpoTexto });
  return POST(req);
}

describe("POST /api/webhooks/realtimekit", () => {
  it("sem rtk-signature vira 401 e não consulta o banco", async () => {
    const r = await postWebhook({ event: "meeting.ended" }, { semAssinatura: true });
    expect(r.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("sem rtk-uuid vira 401 e não consulta o banco", async () => {
    const r = await postWebhook({ event: "meeting.ended" }, { uuid: null });
    expect(r.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("assinatura de chave errada vira 401 e não consulta o banco", async () => {
    const r = await postWebhook({ event: "meeting.ended" }, { chaveErrada: true });
    expect(r.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("evento desconhecido com assinatura válida só registra em webhook_recebidos e devolve 200", async () => {
    const r = await postWebhook({ event: "meeting.started" });
    expect(r.status).toBe(200);
    expect(insertWebhook).toHaveBeenCalledWith("webhook_recebidos", { uuid: "uuid-1", evento: "meeting.started" });
    expect(upsertGravacao).not.toHaveBeenCalled();
    expect(updateSessao).not.toHaveBeenCalled();
  });

  it("rtk-uuid repetido (23505) devolve 200 repetido:true sem processar de novo", async () => {
    erroInsercaoWebhook = { code: "23505", message: "duplicate key" };
    const r = await postWebhook({ event: "recording.statusUpdate", recording: { id: "rec1", status: "UPLOADED" } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ repetido: true });
    expect(upsertGravacao).not.toHaveBeenCalled();
  });

  it("recording.statusUpdate faz upsert em gravacoes com os campos certos e sessao_id achado pela meeting", async () => {
    tabelas.sessoes = { id: "sess-1" };
    const r = await postWebhook({
      event: "recording.statusUpdate",
      recording: {
        id: "rec1",
        status: "UPLOADED",
        downloadUrl: "https://x/rec.mp4",
        recordingDuration: 1800,
        startedTime: "2026-06-03T10:00:00.000Z",
        stoppedTime: "2026-06-03T10:30:00.000Z",
        meetingId: "meet-1",
      },
    });
    expect(r.status).toBe(200);
    expect(upsertGravacao).toHaveBeenCalledWith(
      {
        rtk_recording_id: "rec1",
        sessao_id: "sess-1",
        reuniao_id: null,
        status: "UPLOADED",
        download_url: "https://x/rec.mp4",
        duracao_s: 1800,
        iniciada_em: "2026-06-03T10:00:00.000Z",
        terminada_em: "2026-06-03T10:30:00.000Z",
      },
      { onConflict: "rtk_recording_id" },
    );
  });

  it("recording.statusUpdate arredonda a duração com casas decimais (coluna inteira)", async () => {
    const r = await postWebhook({
      event: "recording.statusUpdate",
      recording: { id: "rec1", status: "UPLOADED", recordingDuration: 28.963, meetingId: "meet-1" },
    });
    expect(r.status).toBe(200);
    expect(upsertGravacao).toHaveBeenCalledWith(expect.objectContaining({ duracao_s: 29 }), expect.anything());
  });

  it("recording.statusUpdate sem sessão achada pela meeting usa sessao_id null", async () => {
    tabelas.sessoes = null;
    const r = await postWebhook({
      event: "recording.statusUpdate",
      recording: { id: "rec1", status: "RECORDING", meetingId: "meet-fantasma" },
    });
    expect(r.status).toBe(200);
    expect(upsertGravacao).toHaveBeenCalledWith(expect.objectContaining({ sessao_id: null }), expect.anything());
  });

  it("recording.statusUpdate de meeting que não é de sessão liga a gravação à reunião instantânea", async () => {
    tabelas.sessoes = null;
    tabelas.reunioes = { id: "reun-1" };
    const r = await postWebhook({
      event: "recording.statusUpdate",
      recording: { id: "rec2", status: "UPLOADED", downloadUrl: "https://x/r.mp4", meetingId: "meet-r" },
    });
    expect(r.status).toBe(200);
    expect(from).toHaveBeenCalledWith("reunioes");
    expect(upsertGravacao).toHaveBeenCalledWith(
      expect.objectContaining({ rtk_recording_id: "rec2", sessao_id: null, reuniao_id: "reun-1", status: "UPLOADED" }),
      { onConflict: "rtk_recording_id" },
    );
  });

  it("recording.statusUpdate de sessão não procura reunião", async () => {
    tabelas.sessoes = { id: "sess-1" };
    tabelas.reunioes = { id: "reun-1" };
    await postWebhook({ event: "recording.statusUpdate", recording: { id: "rec1", status: "RECORDING", meetingId: "meet-1" } });
    expect(from).not.toHaveBeenCalledWith("reunioes");
    expect(upsertGravacao).toHaveBeenCalledWith(expect.objectContaining({ sessao_id: "sess-1", reuniao_id: null }), expect.anything());
  });

  it("meeting.ended de reunião instantânea não mexe na reunião (ela vale 24 h)", async () => {
    tabelas.sessoes = null;
    tabelas.reunioes = { id: "reun-1", encerrada_em: null };
    const r = await postWebhook({ event: "meeting.ended", meeting: { id: "meet-r", reason: "HOST_ENDED_MEETING" } });
    expect(r.status).toBe(200);
    expect(updateSessao).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("reunioes");
  });

  it("meeting.ended encerra sessão que estava ao_vivo", async () => {
    tabelas.sessoes = { id: "sess-1", status: "ao_vivo" };
    const r = await postWebhook({ event: "meeting.ended", meeting: { id: "meet-1", reason: "HOST_ENDED_MEETING" } });
    expect(r.status).toBe(200);
    expect(updateSessao).toHaveBeenCalledWith("sessoes", { status: "encerrada" });
  });

  it("meeting.ended não altera sessão que não estava ao_vivo", async () => {
    tabelas.sessoes = { id: "sess-1", status: "agendada" };
    const r = await postWebhook({ event: "meeting.ended", meeting: { id: "meet-1" } });
    expect(r.status).toBe(200);
    expect(updateSessao).not.toHaveBeenCalled();
  });

  it("falha ao processar desfaz o registro de dedupe e devolve 500", async () => {
    tabelas.sessoes = { id: "sess-1" };
    erroUpsertGravacao = { message: "falhou" };
    const r = await postWebhook({
      event: "recording.statusUpdate",
      recording: { id: "rec1", status: "UPLOADED", meetingId: "meet-1" },
    });
    expect(r.status).toBe(500);
    expect(deleteWebhook).toHaveBeenCalledWith("webhook_recebidos", "uuid", "uuid-1");
  });

  it("corpo que não é JSON válido (mas com assinatura certa) vira 400 e não grava em webhook_recebidos", async () => {
    const r = await postWebhookCorpoBruto("isso não é json {");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erro: "corpo inválido" });
    expect(from).not.toHaveBeenCalled();
  });

  it("fetch da chave pública rejeitando devolve 500 sem consultar o banco", async () => {
    // reseta o registro de módulos: a chave pública já foi cacheada por testes anteriores (cache de 1h em
    // memória), então sem isso o fetch com falha nem seria chamado de novo.
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("rede fora");
      }),
    );
    const r = await postWebhook({ event: "meeting.started" });
    expect(r.status).toBe(500);
    expect(from).not.toHaveBeenCalled();
  });

  it("fetch da chave pública com ok:false devolve 500 sem consultar o banco", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const r = await postWebhook({ event: "meeting.started" });
    expect(r.status).toBe(500);
    expect(from).not.toHaveBeenCalled();
  });

  describe("meeting.ended — formato tolerante do id da meeting", () => {
    it("usa meetingId no nível raiz quando não há meeting.id", async () => {
      tabelas.sessoes = { id: "sess-1", status: "ao_vivo" };
      const r = await postWebhook({ event: "meeting.ended", meetingId: "meet-1", reason: "HOST_ENDED_MEETING" });
      expect(r.status).toBe(200);
      expect(updateSessao).toHaveBeenCalledWith("sessoes", { status: "encerrada" });
    });

    it("usa meeting.meetingId quando meeting não tem id", async () => {
      tabelas.sessoes = { id: "sess-1", status: "ao_vivo" };
      const r = await postWebhook({ event: "meeting.ended", meeting: { meetingId: "meet-1" }, reason: "HOST_ENDED_MEETING" });
      expect(r.status).toBe(200);
      expect(updateSessao).toHaveBeenCalledWith("sessoes", { status: "encerrada" });
    });

    it("sem nenhum id reconhecível só loga e devolve 200, sem alterar sessão", async () => {
      const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
      tabelas.sessoes = { id: "sess-1", status: "ao_vivo" };
      const r = await postWebhook({ event: "meeting.ended", reason: "HOST_ENDED_MEETING" });
      expect(r.status).toBe(200);
      expect(updateSessao).not.toHaveBeenCalled();
      expect(espiao).toHaveBeenCalledWith(
        "[webhook rtk] meeting.ended sem id da meeting",
        expect.arrayContaining(["event", "reason"]),
      );
      espiao.mockRestore();
    });
  });

  it("recording.statusUpdate sem recording.meetingId usa meeting.id do nível raiz como fallback", async () => {
    tabelas.sessoes = { id: "sess-1" };
    const r = await postWebhook({
      event: "recording.statusUpdate",
      recording: { id: "rec1", status: "RECORDING" },
      meeting: { id: "meet-1" },
    });
    expect(r.status).toBe(200);
    expect(upsertGravacao).toHaveBeenCalledWith(expect.objectContaining({ sessao_id: "sess-1" }), expect.anything());
  });

  describe("meeting.ended — só encerra quando o anfitrião encerrou ou já passou do fim programado", () => {
    const minutosAtras = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

    it("todos saíram ANTES do fim programado: sessão continua ao_vivo", async () => {
      tabelas.sessoes = { id: "sess-1", status: "ao_vivo", inicio: minutosAtras(10), agendas: { duracao_min: 60 } };
      const r = await postWebhook({ event: "meeting.ended", meeting: { id: "meet-1" }, reason: "ALL_PARTICIPANTS_LEFT" });
      expect(r.status).toBe(200);
      expect(updateSessao).not.toHaveBeenCalled();
    });

    it("sem reason e antes do fim programado: sessão continua ao_vivo", async () => {
      tabelas.sessoes = { id: "sess-1", status: "ao_vivo", inicio: minutosAtras(10), agendas: { duracao_min: 60 } };
      const r = await postWebhook({ event: "meeting.ended", meeting: { id: "meet-1" } });
      expect(r.status).toBe(200);
      expect(updateSessao).not.toHaveBeenCalled();
    });

    it("todos saíram DEPOIS do fim programado: encerra", async () => {
      tabelas.sessoes = { id: "sess-1", status: "ao_vivo", inicio: minutosAtras(61), agendas: { duracao_min: 60 } };
      const r = await postWebhook({ event: "meeting.ended", meeting: { id: "meet-1" }, reason: "ALL_PARTICIPANTS_LEFT" });
      expect(r.status).toBe(200);
      expect(updateSessao).toHaveBeenCalledWith("sessoes", { status: "encerrada" });
    });

    it("anfitrião encerrou antes do fim programado (reason na raiz): encerra", async () => {
      tabelas.sessoes = { id: "sess-1", status: "ao_vivo", inicio: minutosAtras(10), agendas: { duracao_min: 60 } };
      const r = await postWebhook({ event: "meeting.ended", meeting: { id: "meet-1" }, reason: "HOST_ENDED_MEETING" });
      expect(r.status).toBe(200);
      expect(updateSessao).toHaveBeenCalledWith("sessoes", { status: "encerrada" });
    });
  });

  describe("recording.statusUpdate: arquivo no R2", () => {
    const SESS = "11111111-2222-4333-8444-555555555555";
    const PREFIXO = "s_11111111222243338444555555555555_1761230000000";

    it("UPLOADED com R2: procura pelo prefixo único salvo (com o nome do arquivo) e salva r2_chave", async () => {
      r2Ligado = true;
      tabelas.sessoes = { id: SESS };
      tabelas.gravacoes = { status: "RECORDING", download_url: null, r2_chave: null, r2_prefixo: PREFIXO };
      acharPorPrefixo.mockResolvedValue(`gravacoes/${PREFIXO}_sala_1.mp4`);
      const r = await postWebhook({ event: "recording.statusUpdate", recording: { id: "rec1", status: "UPLOADED", meetingId: "meet-1", outputFileName: "sala_1.mp4" } });
      expect(r.status).toBe(200);
      expect(acharPorPrefixo).toHaveBeenCalledWith(`gravacoes/${PREFIXO}`, "sala_1.mp4");
      const linha = upsertGravacao.mock.calls[0][0];
      expect(linha).toMatchObject({ rtk_recording_id: "rec1", r2_chave: `gravacoes/${PREFIXO}_sala_1.mp4` });
      // O prefixo nunca entra no upsert (não é sobrescrito com null).
      expect(linha).not.toHaveProperty("r2_prefixo");
    });

    it("sem r2_prefixo (gravação antiga ou desconhecida): não adivinha, loga e fica sem r2_chave", async () => {
      r2Ligado = true;
      tabelas.sessoes = { id: SESS };
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
      await postWebhook({ event: "recording.statusUpdate", recording: { id: "rec1", status: "UPLOADED", meetingId: "meet-1" } });
      expect(acharPorPrefixo).not.toHaveBeenCalled();
      expect(aviso).toHaveBeenCalledWith("[webhook rtk] gravação pronta sem prefixo do R2", "rec1");
      expect(upsertGravacao.mock.calls[0][0]).not.toHaveProperty("r2_chave");
      aviso.mockRestore();
    });

    it("arquivo ainda não apareceu ou R2 falhou: salva sem r2_chave e devolve 200", async () => {
      r2Ligado = true;
      tabelas.sessoes = { id: SESS };
      tabelas.gravacoes = { status: "RECORDING", download_url: null, r2_chave: null, r2_prefixo: PREFIXO };
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
      const erro = vi.spyOn(console, "error").mockImplementation(() => {});
      await postWebhook({ event: "recording.statusUpdate", recording: { id: "rec1", status: "UPLOADED", meetingId: "meet-1" } });
      expect(upsertGravacao.mock.calls[0][0]).not.toHaveProperty("r2_chave");
      acharPorPrefixo.mockRejectedValue(new Error("R2 respondeu 500 ao listar."));
      const r = await postWebhook({ event: "recording.statusUpdate", recording: { id: "rec1", status: "UPLOADED", meetingId: "meet-1" } }, { uuid: "uuid-2" });
      expect(r.status).toBe(200);
      expect(upsertGravacao.mock.calls[1][0]).not.toHaveProperty("r2_chave");
      aviso.mockRestore();
      erro.mockRestore();
    });

    it("sem R2, outros status ou chave já salva: nem procura", async () => {
      tabelas.sessoes = { id: SESS };
      tabelas.gravacoes = { status: "RECORDING", download_url: null, r2_chave: null, r2_prefixo: PREFIXO };
      await postWebhook({ event: "recording.statusUpdate", recording: { id: "rec1", status: "UPLOADED", meetingId: "meet-1" } });
      r2Ligado = true;
      await postWebhook({ event: "recording.statusUpdate", recording: { id: "rec1", status: "RECORDING", meetingId: "meet-1" } }, { uuid: "uuid-2" });
      tabelas.gravacoes = { status: "UPLOADED", download_url: null, r2_chave: "gravacoes/s_x.mp4", r2_prefixo: PREFIXO };
      await postWebhook({ event: "recording.statusUpdate", recording: { id: "rec1", status: "UPLOADED", meetingId: "meet-1" } }, { uuid: "uuid-3" });
      expect(acharPorPrefixo).not.toHaveBeenCalled();
      for (const c of upsertGravacao.mock.calls) {
        expect(c[0]).not.toHaveProperty("r2_chave");
        expect(c[0]).not.toHaveProperty("r2_prefixo");
      }
    });
  });

  describe("recording.statusUpdate — status livre e sem regredir de UPLOADED", () => {
    it("PAUSED é gravado como veio", async () => {
      tabelas.sessoes = { id: "sess-1" };
      const r = await postWebhook({ event: "recording.statusUpdate", recording: { id: "rec1", status: "PAUSED", meetingId: "meet-1" } });
      expect(r.status).toBe(200);
      expect(upsertGravacao).toHaveBeenCalledWith(expect.objectContaining({ status: "PAUSED" }), expect.anything());
    });

    it("RECORDING atrasado depois de UPLOADED mantém UPLOADED e o download_url", async () => {
      tabelas.sessoes = { id: "sess-1" };
      tabelas.gravacoes = { status: "UPLOADED", download_url: "https://x/rec.mp4" };
      const r = await postWebhook({ event: "recording.statusUpdate", recording: { id: "rec1", status: "RECORDING", meetingId: "meet-1" } });
      expect(r.status).toBe(200);
      expect(upsertGravacao).toHaveBeenCalledWith(
        expect.objectContaining({ status: "UPLOADED", download_url: "https://x/rec.mp4" }),
        expect.anything(),
      );
    });

    it("UPLOADED de novo atualiza o download_url", async () => {
      tabelas.sessoes = { id: "sess-1" };
      tabelas.gravacoes = { status: "UPLOADED", download_url: "https://x/velho.mp4" };
      await postWebhook({ event: "recording.statusUpdate", recording: { id: "rec1", status: "UPLOADED", downloadUrl: "https://x/novo.mp4", meetingId: "meet-1" } });
      expect(upsertGravacao).toHaveBeenCalledWith(expect.objectContaining({ status: "UPLOADED", download_url: "https://x/novo.mp4" }), expect.anything());
    });
  });

  describe("cache da chave pública", () => {
    let parVelho: CryptoKeyPair;
    let pemVelho: string;

    beforeEach(async () => {
      parVelho ??= await gerarPar();
      pemVelho ??= await exportarPem(parVelho.publicKey);
      vi.resetModules();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    });
    afterEach(() => vi.useRealTimers());

    function fetchChaves(...pems: string[]) {
      const f = vi.fn(async () => {
        const pem = pems.length > 1 ? pems.shift()! : pems[0];
        return { ok: true, json: async () => ({ success: true, data: { publicKey: pem } }) };
      });
      vi.stubGlobal("fetch", f);
      return f;
    }

    it("chave em cache com mais de 5 min e assinatura falhando: busca a chave de novo e aceita", async () => {
      const f = fetchChaves(pemVelho, PEM_CHAVE_PUBLICA);
      const r1 = await postWebhook({ event: "meeting.started" }, { uuid: "u1" });
      expect(r1.status).toBe(401);
      vi.setSystemTime(new Date("2026-10-22T12:06:00Z"));
      const r2 = await postWebhook({ event: "meeting.started" }, { uuid: "u2" });
      expect(r2.status).toBe(200);
      expect(f).toHaveBeenCalledTimes(2);
    });

    it("chave em cache recente (menos de 5 min): não busca de novo e devolve 401", async () => {
      const f = fetchChaves(pemVelho, PEM_CHAVE_PUBLICA);
      await postWebhook({ event: "meeting.started" }, { uuid: "u1" });
      vi.setSystemTime(new Date("2026-10-22T12:04:00Z"));
      const r2 = await postWebhook({ event: "meeting.started" }, { uuid: "u2" });
      expect(r2.status).toBe(401);
      expect(f).toHaveBeenCalledTimes(1);
    });

    it("assinatura de outra chave continua 401 mesmo depois de buscar de novo", async () => {
      const f = fetchChaves(PEM_CHAVE_PUBLICA);
      await postWebhook({ event: "meeting.started" }, { uuid: "u1" });
      vi.setSystemTime(new Date("2026-10-22T12:06:00Z"));
      const r = await postWebhook({ event: "meeting.started" }, { uuid: "u2", chaveErrada: true });
      expect(r.status).toBe(401);
      expect(f).toHaveBeenCalledTimes(2);
    });
  });

  describe("meeting.participantJoined / meeting.participantLeft (presença)", () => {
    const INSC_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    it("participantJoined de inscrito grava presença (upsert on conflict peer_id)", async () => {
      tabelas.sessoes = { id: "sess-1" };
      tabelas.inscricoes = { id: INSC_1 };
      const r = await postWebhook({
        event: "meeting.participantJoined",
        meeting: { id: "meet-1" },
        participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z" },
      });
      expect(r.status).toBe(200);
      expect(upsertPresenca).toHaveBeenCalledWith(
        { sessao_id: "sess-1", inscricao_id: INSC_1, peer_id: "peer-1", entrou_em: "2026-10-23T10:00:00.000Z" },
        { onConflict: "peer_id", ignoreDuplicates: true },
      );
    });

    it("participantJoined de equipe (membro:) é ignorado, sem upsert", async () => {
      tabelas.sessoes = { id: "sess-1" };
      const r = await postWebhook({
        event: "meeting.participantJoined",
        meeting: { id: "meet-1" },
        participant: { peerId: "peer-1", customParticipantId: "membro:abc", joinedAt: "2026-10-23T10:00:00.000Z" },
      });
      expect(r.status).toBe(200);
      expect(upsertPresenca).not.toHaveBeenCalled();
    });

    it("participantLeft fecha a presença (update saiu_em where peer_id e saiu_em is null)", async () => {
      dadosUpdatePresenca = [{ id: "p1" }];
      const r = await postWebhook({
        event: "meeting.participantLeft",
        meeting: { id: "meet-1" },
        participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z", leftAt: "2026-10-23T10:30:00.000Z" },
      });
      expect(r.status).toBe(200);
      expect(updatePresenca).toHaveBeenCalledWith({ saiu_em: "2026-10-23T10:30:00.000Z" });
      expect(upsertPresenca).not.toHaveBeenCalled();
    });

    it("falha ao gravar a presença desfaz o dedupe e devolve 500", async () => {
      tabelas.sessoes = { id: "sess-1" };
      tabelas.inscricoes = { id: INSC_1 };
      erroUpsertPresenca = { message: "falhou" };
      const r = await postWebhook({
        event: "meeting.participantJoined",
        meeting: { id: "meet-1" },
        participant: { peerId: "peer-1", customParticipantId: INSC_1, joinedAt: "2026-10-23T10:00:00.000Z" },
      });
      expect(r.status).toBe(500);
      expect(deleteWebhook).toHaveBeenCalledWith("webhook_recebidos", "uuid", "uuid-1");
    });

    it("formato estranho não lança: devolve 200 e só loga", async () => {
      const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await postWebhook({ event: "meeting.participantJoined" });
      expect(r.status).toBe(200);
      expect(upsertPresenca).not.toHaveBeenCalled();
      expect(espiao).toHaveBeenCalledWith(
        "[webhook rtk] presença sem peerId/customParticipantId",
        expect.arrayContaining(["event"]),
      );
      espiao.mockRestore();
    });
  });
});

