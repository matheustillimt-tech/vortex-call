import { beforeEach, describe, expect, it, vi } from "vitest";

const INSC = "11111111-2222-4333-8444-555555555555";
const SESS = "66666666-7777-4888-9999-aaaaaaaaaaaa";
let inscricao: Record<string, unknown> | null = null;
const eqs: [string, unknown][] = [];
const from = vi.fn((_tabela: string) => {
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => {
      eqs.push([c, v]);
      return q;
    },
    maybeSingle: async () => ({ data: inscricao }),
  };
  return q;
});
const rpc = vi.fn(async (_nome: string, _args: Record<string, unknown>) => ({ data: true as boolean | null, error: null as { message: string } | null }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from, rpc }) }));
const dentroDoLimite = vi.fn(async (_chave: string, _max: number) => true);
vi.mock("@/src/lib/limite", () => ({ dentroDoLimite: (c: string, m: number) => dentroDoLimite(c, m) }));

beforeEach(() => {
  inscricao = { id: INSC, sessao_id: SESS };
  eqs.length = 0;
  from.mockClear();
  rpc.mockClear();
  rpc.mockResolvedValue({ data: true, error: null });
  dentroDoLimite.mockReset();
  dentroDoLimite.mockResolvedValue(true);
});

async function post(corpo: unknown, codigo = "abc123defg") {
  const { POST } = await import("@/app/api/sala/atividade/[codigo]/route");
  const body = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  return POST(new Request("http://x", { method: "POST", body }), { params: Promise.resolve({ codigo }) });
}

describe("POST /api/sala/atividade/[codigo]", () => {
  it("404 com código inválido, sem tocar no banco nem no limite", async () => {
    for (const c of ["x", "ABC123DEFG", "abc123defg1", "../abc1234"]) {
      expect((await post({ mic: 5 }, c)).status).toBe(404);
    }
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(dentroDoLimite).not.toHaveBeenCalled();
  });

  it("429 acima de 6 por minuto por código", async () => {
    dentroDoLimite.mockResolvedValue(false);
    expect((await post({ mic: 5 })).status).toBe(429);
    expect(dentroDoLimite).toHaveBeenCalledWith("sala-atividade:abc123defg", 6);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("404 com código que não existe", async () => {
    inscricao = null;
    expect((await post({ mic: 5 })).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("204 e chama somar_atividade com a inscrição e a sessão do código", async () => {
    const r = await post({ mic: 30, cam: 12, msgs: 2 });
    expect(r.status).toBe(204);
    expect(from).toHaveBeenCalledWith("inscricoes");
    expect(eqs).toContainEqual(["codigo", "abc123defg"]);
    expect(rpc).toHaveBeenCalledWith("somar_atividade", { p_inscricao: INSC, p_sessao: SESS, p_mic: 30, p_cam: 12, p_msgs: 2 });
  });

  it("negativo e não número viram 0; fração é cortada", async () => {
    await post({ mic: -10, cam: "20", msgs: 3.7 });
    expect(rpc).toHaveBeenCalledWith("somar_atividade", { p_inscricao: INSC, p_sessao: SESS, p_mic: 0, p_cam: 0, p_msgs: 3 });
  });

  it("tudo zero ou corpo inválido: 204 sem chamar a função", async () => {
    expect((await post({ mic: 0, cam: 0, msgs: 0 })).status).toBe(204);
    expect((await post("não é json")).status).toBe(204);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("204 mesmo quando a função não soma (sessão fora do ar) ou falha", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect((await post({ mic: 5 })).status).toBe(204);
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "falhou" } });
    expect((await post({ mic: 5 })).status).toBe(204);
    expect(erro).toHaveBeenCalled();
    expect(JSON.stringify(erro.mock.calls)).not.toContain('"mic"');
    erro.mockRestore();
  });
});
