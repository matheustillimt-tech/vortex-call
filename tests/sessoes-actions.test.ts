import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";

const A1 = "11111111-1111-4111-8111-111111111111";
let f: ReturnType<typeof criarDbFalso>;
const exigirAdmin = vi.fn(async () => ({ id: "u1", nome: "Admin", papel: "admin" }));
vi.mock("@/src/lib/supabase/usuario", () => ({
  dbUsuario: async () => f.db,
  exigirAdmin: () => exigirAdmin(),
  exigirMembro: () => exigirAdmin(),
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => f.db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { cancelarSessao, criarSessao } from "@/app/(painel)/sessoes/actions";

beforeEach(() => {
  exigirAdmin.mockClear();
  f = criarDbFalso({
    agendas: [{ id: A1, nome: "Diagnóstico", slug: "diagnostico", ativa: true, vagas_padrao: 30 }],
    sessoes: [{ id: "s1", agenda_id: A1, inicio: "2099-01-01T12:00:00Z", vagas: 10, status: "agendada" }],
    inscricoes: [
      { id: "i1", sessao_id: "s1", status: "agendado" },
      { id: "i2", sessao_id: "s1", status: "compareceu" },
    ],
  });
});

function form(v: Record<string, string>) {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return fd;
}

describe("cancelarSessao (painel usa a regra de src/lib/api/sessoes)", () => {
  it("cancela a sessão e também cancela as inscrições agendadas dela", async () => {
    expect(await cancelarSessao("s1")).toEqual({ ok: true });
    expect(exigirAdmin).toHaveBeenCalled();
    expect(f.tabelas.sessoes[0].status).toBe("cancelada");
    expect(f.tabelas.inscricoes.map((i) => i.status)).toEqual(["cancelado", "compareceu"]);
  });
  it("erro do banco vira erro na tela", async () => {
    f.falhar("sessoes", "update");
    await expect(cancelarSessao("s1")).rejects.toThrow("Não deu para cancelar.");
  });
});

describe("criarSessao (painel)", () => {
  it("valida e cria com a hora de Brasília", async () => {
    expect(await criarSessao({}, form({ agenda_id: A1, inicio: "2000-01-01T10:00", vagas: "10" }))).toEqual({ erro: "Escolha uma data e hora no futuro." });
    expect(await criarSessao({}, form({ agenda_id: A1, inicio: "2099-01-02T10:00", vagas: "0" }))).toEqual({ erro: "Vagas: de 1 a 500." });
    expect(await criarSessao({}, form({ agenda_id: A1, inicio: "2099-01-02T10:00", vagas: "12", titulo: " Turma " }))).toEqual({ ok: true });
    expect(f.tabelas.sessoes[1]).toMatchObject({ agenda_id: A1, inicio: "2099-01-02T13:00:00.000Z", vagas: 12, titulo: "Turma" });
  });
});
