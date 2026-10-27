import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";

const m = vi.hoisted(() => ({
  autenticacoes: 0,
  chave: { valor: "escrita" as "leitura" | "escrita" | null },
}));

vi.mock("@/src/lib/mcp/auth", () => ({
  autenticarChave: async (_req: Request, formato: string) => {
    m.autenticacoes++;
    if (formato !== "rpc") throw new Error("formato errado");
    return m.chave.valor
      ? { chave: { id: "c1", nome: "Claude", permissao: m.chave.valor, usuarioId: "u1" } }
      : Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Chave de acesso ausente ou inválida." } }, { status: 401 });
  },
}));
let f: ReturnType<typeof criarDbFalso>;
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => f.db }));
vi.mock("@/src/lib/realtimekit", () => ({ ErroRtk: class extends Error {}, linkDaGravacao: vi.fn() }));
vi.mock("@/src/lib/reunioes", () => ({ criarReuniao: vi.fn() }));

process.env.NEXT_PUBLIC_SITE_URL = "https://call.exemplo.com.br/";

import pacote from "@/package.json";
import * as rota from "@/app/api/mcp/route";
import { INSTRUCOES } from "@/src/lib/mcp/servidor";

beforeEach(() => {
  m.autenticacoes = 0;
  m.chave.valor = "escrita";
  f = criarDbFalso({
    agendas: [{ id: "11111111-1111-4111-8111-111111111111", nome: "Diagnóstico", slug: "diagnostico", ativa: true, duracao_min: 60, vagas_padrao: 30 }],
  });
});

function req(corpo: unknown, cabecalhos: Record<string, string> = {}) {
  return new Request("https://call.exemplo.com.br/api/mcp", {
    method: "POST",
    headers: { authorization: "Bearer vc_x", "content-type": "application/json", ...cabecalhos },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}
const enviar = async (corpo: unknown, cabecalhos?: Record<string, string>) => rota.POST(req(corpo, cabecalhos));
const rpc = async (corpo: unknown) => (await enviar(corpo)).json();

describe("POST /api/mcp: protocolo", () => {
  it("initialize: nome, versão do pacote, instruções e versão de protocolo pedida (ou a padrão)", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    expect(r.result.protocolVersion).toBe("2025-03-26");
    expect(r.result.serverInfo).toEqual({ name: "vortex-call", version: pacote.version });
    expect(r.result.capabilities).toEqual({ tools: {} });
    expect(r.result.instructions).toBe(INSTRUCOES);
    expect(INSTRUCOES).toMatch(/cancelar_sessao avisa o total de inscritos e exige confirmar=true/);
    const outra = await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(outra.result.protocolVersion).toBe("2025-06-18");
  });

  it("tools/list: as 10 ferramentas, sem campos internos", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(r.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "listar_agendas",
      "listar_sessoes",
      "criar_sessao",
      "cancelar_sessao",
      "ver_inscritos",
      "ver_ficha",
      "ver_resumo_call",
      "listar_gravacoes",
      "link_gravacao",
      "criar_reuniao",
    ]);
    for (const t of r.result.tools) {
      expect(t).not.toHaveProperty("escrita");
      expect(t).not.toHaveProperty("executar");
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("notificação → 202 sem corpo", async () => {
    const r = await enviar({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(r.status).toBe(202);
    expect(await r.text()).toBe("");
  });

  it("lote: responde cada requisição em ordem, ignora notificação e conta 1 chamada por requisição HTTP", async () => {
    const r = await rpc([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: "b", method: "tools/list" },
    ]);
    expect(r.map((x: { id: unknown }) => x.id)).toEqual([1, "b"]);
    expect(m.autenticacoes).toBe(1);
  });

  it("lote vazio ou com mais de 20 → 400", async () => {
    expect((await enviar([])).status).toBe(400);
    const grande = Array.from({ length: 21 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }));
    expect((await enviar(grande)).status).toBe(400);
  });

  it("método inexistente → -32601", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 7, method: "resources/list" });
    expect(r.error.code).toBe(-32601);
    expect(r.id).toBe(7);
  });

  it("parâmetros inválidos → -32602 (params, nome, ferramenta desconhecida, arguments)", async () => {
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: [1] })).error.code).toBe(-32602);
    expect((await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {} })).error.code).toBe(-32602);
    expect((await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nao_existe" } })).error.code).toBe(-32602);
    expect((await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "listar_agendas", arguments: "x" } })).error.code).toBe(-32602);
  });

  it("JSON inválido → 400 -32700; requisição sem jsonrpc 2.0 → -32600", async () => {
    const r = await enviar("{");
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe(-32700);
    expect((await rpc({ id: 1, method: "ping" })).error.code).toBe(-32600);
  });

  it("versão de protocolo no header não suportada → 400", async () => {
    expect((await enviar({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "1999-01-01" })).status).toBe(400);
    expect((await enviar({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "2025-06-18" })).status).toBe(200);
  });

  it("tools/call: roda a ferramenta e devolve texto + structuredContent", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "listar_agendas" } });
    expect(r.result.isError).toBeUndefined();
    expect(r.result.content[0]).toMatchObject({ type: "text" });
    expect(r.result.structuredContent.agendas[0].link_agendar).toBe("https://call.exemplo.com.br/agendar/diagnostico");
  });

  it("tools/call: chave de leitura em ferramenta de escrita → isError, sem tocar no banco", async () => {
    m.chave.valor = "leitura";
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "criar_reuniao", arguments: {} } });
    expect(r.result).toEqual({ content: [{ type: "text", text: "Esta chave é só de leitura." }], isError: true });
    expect(f.chamadas).toHaveLength(0);
  });

  it("tools/call: erro inesperado vira isError genérico, sem derrubar a resposta", async () => {
    f.falhar("agendas", "select");
    const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "listar_agendas" } });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toBe("Não deu para concluir a chamada. Tente de novo.");
    expect(erroLog).toHaveBeenCalledWith("[mcp] listar_agendas", "Não deu para listar as agendas.");
    erroLog.mockRestore();
  });
});

describe("POST /api/mcp: acesso", () => {
  it("sem chave válida → a resposta de autenticação (401)", async () => {
    m.chave.valor = null;
    const r = await enviar({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(r.status).toBe(401);
  });

  it("Origin de outro site → 403 sem nem autenticar; sem Origin ou com a do site → passa", async () => {
    const estranho = await enviar({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://malicioso.com" });
    expect(estranho.status).toBe(403);
    expect(m.autenticacoes).toBe(0);
    expect((await enviar({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://call.exemplo.com.br" })).status).toBe(200);
    expect((await enviar({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(200);
  });

  it("corpo acima de 1 MB → 413", async () => {
    const r = await enviar({ jsonrpc: "2.0", id: 1, method: "ping", params: { x: "a".repeat(1024 * 1024) } });
    expect(r.status).toBe(413);
  });

  it("GET e DELETE → 405 com Allow: POST; rota sem cache e com 30 s", async () => {
    for (const r of [rota.GET(), rota.DELETE()]) {
      expect(r.status).toBe(405);
      expect(r.headers.get("allow")).toBe("POST");
    }
    expect(rota.dynamic).toBe("force-dynamic");
    expect(rota.maxDuration).toBe(30);
  });
});
