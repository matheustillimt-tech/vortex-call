import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: { valores: unknown; id: unknown }[] = [];
vi.mock("@/src/lib/supabase/usuario", () => ({
  exigirAdmin: async () => ({ id: "u-gab", nome: "Gabriel", papel: "admin" }),
  dbUsuario: async () => ({
    from: () => ({
      update: (valores: unknown) => ({
        eq: async (_c: string, id: unknown) => {
          updates.push({ valores, id });
          return { error: null };
        },
      }),
    }),
  }),
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { editarPessoa } from "@/app/(painel)/equipe/actions";

beforeEach(() => {
  updates.length = 0;
});

describe("editarPessoa", () => {
  it("salva categoria e WhatsApp em E.164 (vazio limpa)", async () => {
    expect(await editarPessoa("u-h", { papel: "membro", whatsapp: "(11) 3888-7777" })).toEqual({ ok: true });
    await editarPessoa("u-h", { papel: "admin", whatsapp: "" });
    expect(updates).toEqual([
      { id: "u-h", valores: { papel: "membro", whatsapp: "+551138887777" } },
      { id: "u-h", valores: { papel: "admin", whatsapp: null } },
    ]);
  });

  it("WhatsApp inválido não salva", async () => {
    expect(await editarPessoa("u-h", { papel: "membro", whatsapp: "123" })).toEqual({ erro: "Confira o WhatsApp (com DDD)." });
    expect(updates).toEqual([]);
  });

  it("a própria pessoa muda só o WhatsApp, nunca a categoria", async () => {
    await editarPessoa("u-gab", { papel: "admin", whatsapp: "1137776666" });
    expect(updates).toEqual([{ id: "u-gab", valores: { whatsapp: "+551137776666" } }]);
    expect(await editarPessoa("u-gab", { papel: "membro", whatsapp: "" })).toEqual({ erro: "Você não pode mudar o próprio papel." });
  });

  it("categoria inválida erra", async () => {
    expect(await editarPessoa("u-h", { papel: "dono" as "admin", whatsapp: "" })).toEqual({ erro: "Papel inválido." });
  });
});
