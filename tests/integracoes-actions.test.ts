import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";

let f: ReturnType<typeof criarDbFalso>;
const exigirAdmin = vi.fn(async () => ({ id: "admin1", nome: "Admin", papel: "admin" }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirAdmin: () => exigirAdmin() }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => f.db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { criarChaveIntegracao, revogarChaveIntegracao } from "@/app/(painel)/integracoes/actions";

beforeEach(() => {
  exigirAdmin.mockClear();
  exigirAdmin.mockImplementation(async () => ({ id: "admin1", nome: "Admin", papel: "admin" }));
  f = criarDbFalso({ chaves_api: [{ id: "c1", nome: "Claude antigo", permissao: "leitura", prefixo: "ABCDEFGH", hash: "x", criada_por: "admin1", revogada_em: null }] });
});

function form(v: Record<string, string>) {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return fd;
}

describe("criarChaveIntegracao (painel)", () => {
  it("só admin: confere exigirAdmin antes de criar", async () => {
    await criarChaveIntegracao({}, form({ nome: "Claude do Gabriel", permissao: "escrita" }));
    expect(exigirAdmin).toHaveBeenCalled();
  });

  it("recusa quem não é admin (exigirAdmin rejeita) sem criar nada", async () => {
    exigirAdmin.mockRejectedValueOnce(new Error("Só administradores podem fazer isso."));
    await expect(criarChaveIntegracao({}, form({ nome: "Claude", permissao: "escrita" }))).rejects.toThrow("Só administradores");
    expect(f.tabelas.chaves_api).toHaveLength(1);
  });

  it("cria e devolve a chave em texto uma vez, com criada_por = quem está logado", async () => {
    const r = await criarChaveIntegracao({}, form({ nome: "Claude do Gabriel", permissao: "escrita" }));
    expect(r.chave).toMatch(/^vc_[0-9A-Za-z]{40}$/);
    expect(f.tabelas.chaves_api).toHaveLength(2);
    expect(f.tabelas.chaves_api[1]).toMatchObject({ nome: "Claude do Gabriel", permissao: "escrita", criada_por: "admin1" });
  });

  it("nome vazio não cria nada", async () => {
    const r = await criarChaveIntegracao({}, form({ nome: "", permissao: "escrita" }));
    expect(r.erro).toBeTruthy();
    expect(f.tabelas.chaves_api).toHaveLength(1);
  });
});

describe("revogarChaveIntegracao (painel)", () => {
  it("marca revogada_em", async () => {
    const r = await revogarChaveIntegracao("c1");
    expect(r.erro).toBeUndefined();
    expect(f.tabelas.chaves_api[0].revogada_em).toBeTruthy();
  });

  it("confere admin antes de revogar", async () => {
    await revogarChaveIntegracao("c1");
    expect(exigirAdmin).toHaveBeenCalled();
  });

  it("chave já revogada ou inexistente devolve erro", async () => {
    await revogarChaveIntegracao("c1");
    const r = await revogarChaveIntegracao("c1");
    expect(r.erro).toBe("Chave não encontrada ou já revogada.");
  });
});
