import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirAdmin = vi.fn(async () => ({ id: "u1", nome: "Admin", papel: "admin" }));
const excluirAgenda = vi.fn(async (_db: unknown, _id: string) => {});
const excluirSessao = vi.fn(async (_db: unknown, _id: string) => {});
const excluirReuniao = vi.fn(async (_db: unknown, _id: string) => {});
const excluirGravacao = vi.fn(async (_db: unknown, _id: string) => {});
const revalidatePath = vi.fn((_caminho: string) => {});
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const DB_ADMIN = { marca: "dbAdmin" };

vi.mock("@/src/lib/supabase/usuario", () => ({
  dbUsuario: async () => ({}),
  exigirAdmin: () => exigirAdmin(),
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => DB_ADMIN }));
vi.mock("@/src/lib/api/excluir", () => ({
  excluirAgenda: (db: unknown, id: string) => excluirAgenda(db, id),
  excluirSessao: (db: unknown, id: string) => excluirSessao(db, id),
  excluirReuniao: (db: unknown, id: string) => excluirReuniao(db, id),
  excluirGravacao: (db: unknown, id: string) => excluirGravacao(db, id),
}));
vi.mock("next/cache", () => ({ revalidatePath: (caminho: string) => revalidatePath(caminho) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

import { excluirAgendaAction } from "@/app/(painel)/agendas/actions";
import { excluirGravacaoAction } from "@/app/(painel)/gravacoes/actions";
import { excluirReuniaoAction } from "@/app/(painel)/reunioes/actions";
import { excluirSessaoAction } from "@/app/(painel)/sessoes/actions";

beforeEach(() => {
  vi.clearAllMocks();
  exigirAdmin.mockImplementation(async () => ({ id: "u1", nome: "Admin", papel: "admin" }));
});

const CASOS = [
  { nome: "agenda", acao: excluirAgendaAction, dominio: excluirAgenda, caminho: "/agendas" },
  { nome: "sessão", acao: excluirSessaoAction, dominio: excluirSessao, caminho: "/sessoes" },
  { nome: "reunião", acao: excluirReuniaoAction, dominio: excluirReuniao, caminho: "/reunioes" },
  { nome: "gravação", acao: excluirGravacaoAction, dominio: excluirGravacao, caminho: "/gravacoes" },
] as const;

for (const c of CASOS) {
  describe(`excluir${c.nome} (action)`, () => {
    it("exige admin: quem não é admin nunca chega a apagar", async () => {
      exigirAdmin.mockImplementation(async () => {
        throw new Error("Só administradores podem fazer isso.");
      });
      await expect(c.acao("id1", "EXCLUIR")).rejects.toThrow("Só administradores podem fazer isso.");
      expect(c.dominio).not.toHaveBeenCalled();
    });

    it("recusa confirmação errada ou vazia, mesmo sendo admin", async () => {
      await expect(c.acao("id1", "")).rejects.toThrow('Digite "EXCLUIR" para confirmar.');
      await expect(c.acao("id1", "excluir")).rejects.toThrow('Digite "EXCLUIR" para confirmar.');
      await expect(c.acao("id1", "EXCLUIR ")).rejects.toThrow('Digite "EXCLUIR" para confirmar.');
      expect(c.dominio).not.toHaveBeenCalled();
    });

    it("com admin e o texto certo, apaga com dbAdmin, atualiza a tela e não redireciona (quem navega é o botão)", async () => {
      await c.acao("id1", "EXCLUIR");
      expect(c.dominio).toHaveBeenCalledWith(DB_ADMIN, "id1");
      expect(revalidatePath).toHaveBeenCalledWith(c.caminho);
      expect(redirect).not.toHaveBeenCalled();
    });
  });
}
