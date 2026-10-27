import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const tabelas: Record<string, unknown> = {};
function consulta(tabela: string) {
  const q = {
    select: () => q, eq: () => q,
    maybeSingle: async () => ({ data: tabelas[tabela] ?? null }),
  };
  return q;
}
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from: consulta, rpc }) }));

beforeEach(() => {
  tabelas.agendas = { slug: "vendas", titulo_publico: "Call", descricao: "", duracao_min: 60 };
  rpc.mockReset();
});

async function get() {
  const { GET } = await import("@/app/api/agendamento/[agenda]/route");
  return GET(new Request("http://x"), { params: Promise.resolve({ agenda: "vendas" }) });
}

describe("GET /api/agendamento/[agenda]", () => {
  it("devolve agenda e sessões", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const r = await get();
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.agenda.slug).toBe("vendas");
    expect(j.sessoes).toEqual([]);
  });

  it("agenda inexistente vira 404", async () => {
    tabelas.agendas = null;
    const r = await get();
    expect(r.status).toBe(404);
  });

  it("erro na RPC vira 500", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "falhou" } });
    const r = await get();
    expect(r.status).toBe(500);
    expect((await r.json()).erro).toBe("Não deu para carregar os horários.");
  });
});

describe("GET /api/agendamento/[agenda] com janela", () => {
  it("mostra só os primeiros N dias com horário (sábado, N=2: segunda e terça)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T15:00:00Z"));
    try {
      tabelas.agendas = { slug: "vendas", titulo_publico: "Call", descricao: "", duracao_min: 60, janela_dias: 2 };
      rpc.mockResolvedValue({
        data: [
          { id: "seg", inicio: "2026-10-26T13:00:00Z", vagas: 10, inscritos: 0, status: "agendada" },
          { id: "ter", inicio: "2026-10-27T13:00:00Z", vagas: 10, inscritos: 10, status: "agendada" },
          { id: "ter2", inicio: "2026-10-27T19:00:00Z", vagas: 10, inscritos: 3, status: "agendada" },
          { id: "qua", inicio: "2026-10-28T13:00:00Z", vagas: 10, inscritos: 0, status: "agendada" },
        ],
        error: null,
      });
      const j = await (await get()).json();
      expect(j.sessoes.map((s: { id: string }) => s.id)).toEqual(["seg", "ter", "ter2"]);
      expect(j.agenda).not.toHaveProperty("janela_dias");
    } finally {
      vi.useRealTimers();
    }
  });
});
