import { beforeEach, describe, expect, it, vi } from "vitest";

/** Banco falso: `chaves_api` (busca pelo hash) e a RPC `api_registrar_uso`. */
const estado = { chave: null as Record<string, unknown> | null, usos: 0, erroBusca: false, erroRpc: false };

function consulta() {
  const p: any = {};
  for (const m of ["select", "eq", "is", "order", "limit"]) p[m] = () => p;
  p.maybeSingle = () => Promise.resolve(estado.erroBusca ? { data: null, error: { message: "x" } } : { data: estado.chave, error: null });
  return p;
}

vi.mock("@/src/lib/supabase/admin", () => ({
  dbAdmin: () => ({
    from: () => consulta(),
    rpc: () => Promise.resolve(estado.erroRpc ? { data: null, error: { message: "x" } } : { data: ++estado.usos, error: null }),
  }),
}));

const CHAVE = "vc_" + "A".repeat(40);

function req(cabecalhos: Record<string, string> = { authorization: `Bearer ${CHAVE}` }) {
  return new Request("https://painel.x.com/api/v1/gravacoes", { headers: cabecalhos });
}

beforeEach(() => {
  estado.chave = { id: "c1", nome: "Claude", permissao: "escrita", criada_por: "u1", revogada_em: null, usuarios: { ativo: true, papel: "admin" } };
  estado.usos = 0;
  estado.erroBusca = false;
  estado.erroRpc = false;
});

const importa = () => import("@/src/lib/mcp/auth");

describe("autenticarChave", () => {
  it("sem header → 401, formato REST com { erro }", async () => {
    const { autenticarChave } = await importa();
    const r = await autenticarChave(req({}), "rest");
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(401);
    expect(await (r as Response).json()).toEqual({ erro: "Chave de acesso ausente ou inválida." });
  });

  it("sem header → 401, formato RPC com jsonrpc/id null/error", async () => {
    const { autenticarChave } = await importa();
    const r = (await autenticarChave(req({}), "rpc")) as Response;
    expect(r.status).toBe(401);
    const corpo = await r.json();
    expect(corpo.jsonrpc).toBe("2.0");
    expect(corpo.id).toBeNull();
    expect(corpo.error.message).toBe("Chave de acesso ausente ou inválida.");
  });

  it("chave mal formada → 401", async () => {
    const { autenticarChave } = await importa();
    const r = (await autenticarChave(req({ authorization: "Bearer gw_123" }), "rest")) as Response;
    expect(r.status).toBe(401);
  });

  it("todo 401 leva WWW-Authenticate: Bearer realm=\"vortex-call\"", async () => {
    const { autenticarChave } = await importa();
    const r = (await autenticarChave(req({}), "rest")) as Response;
    expect(r.headers.get("www-authenticate")).toBe('Bearer realm="vortex-call"');
  });

  it("chave revogada → 401", async () => {
    estado.chave = { ...estado.chave!, revogada_em: "2026-10-21T00:00:00Z" };
    const { autenticarChave } = await importa();
    const r = (await autenticarChave(req(), "rest")) as Response;
    expect(r.status).toBe(401);
  });

  it("chave inexistente (hash não encontrado) → 401", async () => {
    estado.chave = null;
    const { autenticarChave } = await importa();
    const r = (await autenticarChave(req(), "rest")) as Response;
    expect(r.status).toBe(401);
  });

  it("criador desativado → 401", async () => {
    estado.chave = { ...estado.chave!, usuarios: { ativo: false, papel: "admin" } };
    const { autenticarChave } = await importa();
    const r = (await autenticarChave(req(), "rest")) as Response;
    expect(r.status).toBe(401);
  });

  it("criador deixou de ser admin → 401", async () => {
    estado.chave = { ...estado.chave!, usuarios: { ativo: true, papel: "membro" } };
    const { autenticarChave } = await importa();
    const r = (await autenticarChave(req(), "rest")) as Response;
    expect(r.status).toBe(401);
  });

  it("acima de 120 chamadas no minuto → 429 com retry-after", async () => {
    estado.usos = 120;
    const { autenticarChave } = await importa();
    const r = (await autenticarChave(req(), "rest")) as Response;
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
  });

  it("erro do banco ao buscar a chave → 503", async () => {
    estado.erroBusca = true;
    const { autenticarChave } = await importa();
    const r = (await autenticarChave(req(), "rest")) as Response;
    expect(r.status).toBe(503);
  });

  it("erro do banco ao registrar uso → 503", async () => {
    estado.erroRpc = true;
    const { autenticarChave } = await importa();
    const r = (await autenticarChave(req(), "rest")) as Response;
    expect(r.status).toBe(503);
  });

  it("chave válida → devolve { chave } com id, nome, permissao, usuarioId", async () => {
    const { autenticarChave } = await importa();
    const r = await autenticarChave(req(), "rest");
    expect(r).toEqual({ chave: { id: "c1", nome: "Claude", permissao: "escrita", usuarioId: "u1" } });
  });

  it("nunca manda a chave em texto pra nenhum lugar observável (erro genérico, sem eco do header)", async () => {
    const { autenticarChave } = await importa();
    const r = (await autenticarChave(req({ authorization: "Bearer vc_invalida" }), "rest")) as Response;
    const corpo = await r.json();
    expect(JSON.stringify(corpo)).not.toContain("vc_invalida");
  });
});
