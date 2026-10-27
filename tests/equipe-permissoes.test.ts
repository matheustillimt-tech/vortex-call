import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";
import { PERMISSOES_PADRAO } from "@/src/lib/regras/permissoes";

let f: ReturnType<typeof criarDbFalso>;
let souAdmin = true;
vi.mock("@/src/lib/supabase/usuario", () => ({
  exigirAdmin: async () => {
    if (!souAdmin) throw new Error("Só administradores podem fazer isso.");
    return { id: "u-gab", nome: "Gabriel", papel: "admin" };
  },
  dbUsuario: async () => f.db,
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => f.db }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { salvarPermissoes } from "@/app/(painel)/equipe/actions";

beforeEach(() => {
  souAdmin = true;
  f = criarDbFalso({
    usuarios: [
      { id: "u-gab", nome: "Gabriel", papel: "admin", permissoes: PERMISSOES_PADRAO },
      { id: "u-h", nome: "Hugo", papel: "membro", permissoes: PERMISSOES_PADRAO },
    ],
  });
});

const hugo = () => f.tabelas.usuarios.find((u) => u.id === "u-h")!.permissoes;

describe("salvarPermissoes", () => {
  it("admin salva as chaves do membro; chave desconhecida e valor não booleano são ignorados", async () => {
    expect(await salvarPermissoes("u-h", { receita: false, todas_agendas: true, hacker: true, ficha: "nao" })).toEqual({ ok: true });
    expect(hugo()).toEqual({ ...PERMISSOES_PADRAO, receita: false, todas_agendas: true });
  });

  it("não mexe em admin (admin tem tudo)", async () => {
    expect(await salvarPermissoes("u-gab", { receita: false })).toEqual({ erro: "Admin tem acesso a tudo." });
    expect(f.tabelas.usuarios[0].permissoes).toEqual(PERMISSOES_PADRAO);
  });

  it("quem não é admin não salva", async () => {
    souAdmin = false;
    await expect(salvarPermissoes("u-h", { receita: false })).rejects.toThrow("Só administradores");
    expect(hugo()).toEqual(PERMISSOES_PADRAO);
  });

  it("usuário inexistente ou entrada que não é objeto", async () => {
    expect(await salvarPermissoes("u-x", { receita: false })).toEqual({ erro: "Usuário não encontrado." });
    expect(await salvarPermissoes("u-h", [true])).toEqual({ erro: "Permissões inválidas." });
    expect(await salvarPermissoes("u-h", null)).toEqual({ erro: "Permissões inválidas." });
    expect(hugo()).toEqual(PERMISSOES_PADRAO);
  });
});
