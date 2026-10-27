import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/supabase/navegador", () => ({ dbNavegador: () => ({}) }));

import { itensDoMenu } from "@/app/(painel)/_componentes/menu";
import { PERMISSOES_PADRAO } from "@/src/lib/regras/permissoes";

const rotulos = (i: { rotulo: string }[]) => i.map((x) => x.rotulo);

describe("itensDoMenu", () => {
  it("membro com o padrão: igual a antes (sem os itens de admin)", () => {
    expect(rotulos(itensDoMenu("membro", PERMISSOES_PADRAO))).toEqual(["Início", "Sessões", "Horários", "Reuniões", "Gravações"]);
    expect(rotulos(itensDoMenu("membro"))).toEqual(["Início", "Sessões", "Horários", "Reuniões", "Gravações"]);
  });
  it("sem dashboard, horarios e gravacoes: somem Início, Horários e Gravações", () => {
    const p = { ...PERMISSOES_PADRAO, dashboard: false, horarios: false, gravacoes: false };
    expect(rotulos(itensDoMenu("membro", p))).toEqual(["Sessões", "Reuniões"]);
  });
  it("admin vê tudo, mesmo com as chaves desligadas", () => {
    const p = { ...PERMISSOES_PADRAO, dashboard: false, horarios: false, gravacoes: false };
    expect(itensDoMenu("admin", p)).toHaveLength(9);
  });
});
