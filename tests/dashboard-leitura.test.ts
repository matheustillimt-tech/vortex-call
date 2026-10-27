import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { lerResumo, lerSessoes, lerVendedores } from "@/src/lib/dashboard";

function dbCom(data: unknown) {
  const rpc = vi.fn(async () => ({ data, error: null }));
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

const P = { de: new Date("2026-10-01T03:00:00Z"), ate: null, agenda: null, sessao: null, vendedor: "v1" };

describe("leitura do dashboard", () => {
  it("passa o vendedor pras funções", async () => {
    const { db, rpc } = dbCom([]);
    await lerResumo(db, P);
    await lerSessoes(db, P);
    expect(rpc).toHaveBeenCalledWith("dashboard_resumo", { p_de: "2026-10-01T03:00:00.000Z", p_ate: null, p_agenda: null, p_sessao: null, p_vendedor: "v1" });
    expect(rpc).toHaveBeenCalledWith("dashboard_sessoes", expect.objectContaining({ p_vendedor: "v1" }));
  });

  it("sessões trazem o anfitrião", async () => {
    const { db } = dbCom([{ id: "s1", inicio: "2026-10-20T12:00:00Z", agenda: "Impl", titulo: null, inscritos: "2", anfitriao: "Hugo" }]);
    expect((await lerSessoes(db, P))[0]).toMatchObject({ inscritos: 2, anfitriao: "Hugo" });
  });

  it("lerVendedores converte números e mantém nulos de antecedência e nota", async () => {
    const { db, rpc } = dbCom([
      {
        vendedor_id: "v1", nome: "Hugo", sessoes: 3, realizadas: 2, conduzidas: 2, sem_anfitriao: 1,
        antecedencia_media_min: "4.5", inscritos: 10, vieram: 4, interagiram: 3, nota_media: "55.5", compraram: 1, receita_centavos: "199700",
      },
      {
        vendedor_id: null, nome: null, sessoes: 1, realizadas: 0, conduzidas: 0, sem_anfitriao: 1,
        antecedencia_media_min: null, inscritos: 2, vieram: 0, interagiram: 0, nota_media: null, compraram: 0, receita_centavos: "0",
      },
    ]);
    const r = await lerVendedores(db, { de: null, ate: null, agenda: "a1", vendedor: null });
    expect(rpc).toHaveBeenCalledWith("dashboard_vendedores", { p_de: null, p_ate: null, p_agenda: "a1", p_vendedor: null });
    expect(r).toEqual([
      {
        vendedor_id: "v1", nome: "Hugo", sessoes: 3, realizadas: 2, conduzidas: 2, sem_anfitriao: 1,
        antecedencia_media_min: 4.5, inscritos: 10, vieram: 4, interagiram: 3, nota_media: 55.5, compraram: 1, receita_centavos: 199700,
      },
      {
        vendedor_id: null, nome: null, sessoes: 1, realizadas: 0, conduzidas: 0, sem_anfitriao: 1,
        antecedencia_media_min: null, inscritos: 2, vieram: 0, interagiram: 0, nota_media: null, compraram: 0, receita_centavos: 0,
      },
    ]);
  });
});
