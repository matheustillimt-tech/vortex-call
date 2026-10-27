import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";

// Horários pelo vendedor: o responsável pela agenda (membro) cria sessão avulsa e repetição, para repetição, muda vagas
// e cancela sessão vazia, só nas agendas dele. Admin segue podendo tudo (e cancela com inscritos, como antes).
const MINHA = "11111111-1111-4111-8111-111111111111";
const OUTRA = "22222222-2222-4222-8222-222222222222";
const ADMIN = { id: "u-admin", nome: "Admin", papel: "admin" as const };
const VENDEDOR = { id: "u-vend", nome: "Hugo", papel: "membro" as const };

let f: ReturnType<typeof criarDbFalso>;
let eu: { id: string; nome: string; papel: "admin" | "membro"; permissoes?: Record<string, boolean> };
const rpc = vi.fn();
const gerar = vi.fn(async () => 0);

vi.mock("@/src/lib/supabase/usuario", () => ({
  dbUsuario: async () => f.db,
  exigirMembro: async () => eu,
  exigirAdmin: async () => {
    if (eu.papel !== "admin") throw new Error("Só administradores podem fazer isso.");
    return eu;
  },
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from: (t: string) => f.db.from(t), rpc }) }));
vi.mock("@/src/lib/sessoes-repetidas", () => ({ gerarSessoesRepetidas: () => gerar() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { alterarVagas, cancelarSessao, criarRepeticao, criarSessao, pararRepeticao } from "@/app/(painel)/sessoes/actions";

function form(v: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) for (const y of Array.isArray(x) ? x : [x]) fd.append(k, y);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  eu = VENDEDOR;
  f = criarDbFalso({
    agendas: [
      { id: MINHA, nome: "Implementação", ativa: true, vagas_padrao: 30, responsavel_id: VENDEDOR.id },
      { id: OUTRA, nome: "Vendas", ativa: true, vagas_padrao: 30, responsavel_id: "u-outro" },
    ],
    repeticoes: [
      { id: "r-minha", agenda_id: MINHA, ativa: true },
      { id: "r-outra", agenda_id: OUTRA, ativa: true },
    ],
    sessoes: [
      { id: "s-minha", agenda_id: MINHA, inicio: "2099-01-01T12:00:00Z", vagas: 10, status: "agendada" },
      { id: "s-outra", agenda_id: OUTRA, inicio: "2099-01-01T12:00:00Z", vagas: 10, status: "agendada" },
    ],
    inscricoes: [],
  });
});

const SO_GESTOR = "Só o admin ou o responsável pela agenda pode fazer isso.";

describe("criarSessao (avulsa)", () => {
  it("vendedor cria na agenda dele", async () => {
    expect(await criarSessao({}, form({ agenda_id: MINHA, inicio: "2099-01-02T10:00", vagas: "12" }))).toEqual({ ok: true });
    expect(f.tabelas.sessoes.at(-1)).toMatchObject({ agenda_id: MINHA, vagas: 12 });
  });
  it("vendedor não cria em agenda de outro", async () => {
    expect(await criarSessao({}, form({ agenda_id: OUTRA, inicio: "2099-01-02T10:00", vagas: "12" }))).toEqual({ erro: SO_GESTOR });
    expect(f.tabelas.sessoes).toHaveLength(2);
  });
  it("admin cria em qualquer agenda", async () => {
    eu = ADMIN;
    expect(await criarSessao({}, form({ agenda_id: OUTRA, inicio: "2099-01-02T10:00", vagas: "12" }))).toEqual({ ok: true });
  });
});

describe("criarRepeticao / pararRepeticao", () => {
  const repeticao = (agenda: string) => form({ agenda_id: agenda, dias: ["1", "3"], hora: "19:00", vagas: "20", ate: "" });

  it("vendedor cria repetição na agenda dele e as sessões são geradas", async () => {
    expect(await criarRepeticao({}, repeticao(MINHA))).toEqual({ ok: true });
    expect(f.tabelas.repeticoes.at(-1)).toMatchObject({ agenda_id: MINHA, dias_semana: [1, 3], hora: "19:00", vagas: 20, ate: null });
    expect(gerar).toHaveBeenCalled();
  });
  it("vendedor não cria repetição em agenda de outro", async () => {
    expect(await criarRepeticao({}, repeticao(OUTRA))).toEqual({ erro: SO_GESTOR });
    expect(f.tabelas.repeticoes).toHaveLength(2);
    expect(gerar).not.toHaveBeenCalled();
  });
  it("vendedor para a repetição dele, não a de outro", async () => {
    expect(await pararRepeticao("r-minha")).toEqual({ ok: true });
    expect(await pararRepeticao("r-outra")).toEqual({ erro: SO_GESTOR });
    expect(f.tabelas.repeticoes.map((r) => r.ativa)).toEqual([false, true]);
  });
  it("admin para qualquer repetição", async () => {
    eu = ADMIN;
    expect(await pararRepeticao("r-outra")).toEqual({ ok: true });
    expect(f.tabelas.repeticoes[1].ativa).toBe(false);
  });
});

describe("alterarVagas", () => {
  it("vendedor muda as vagas da sessão dele (pela função atômica)", async () => {
    rpc.mockResolvedValue({ data: { resultado: "ok", inscritos: 2 }, error: null });
    expect(await alterarVagas("s-minha", {}, form({ vagas: "15" }))).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("alterar_vagas_sessao", { p_sessao: "s-minha", p_vagas: 15 });
  });
  it("recusa abaixo dos inscritos", async () => {
    rpc.mockResolvedValue({ data: { resultado: "abaixo_inscritos", inscritos: 7 }, error: null });
    expect(await alterarVagas("s-minha", {}, form({ vagas: "5" }))).toEqual({ erro: "Essa sessão já tem 7 inscritos: as vagas não podem ficar abaixo disso." });
  });
  it("recusa vagas inválidas sem chamar o banco", async () => {
    expect(await alterarVagas("s-minha", {}, form({ vagas: "0" }))).toEqual({ erro: "Vagas: de 1 a 500." });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("vendedor não muda sessão de outra agenda", async () => {
    expect(await alterarVagas("s-outra", {}, form({ vagas: "15" }))).toEqual({ erro: SO_GESTOR });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("admin muda qualquer sessão", async () => {
    eu = ADMIN;
    rpc.mockResolvedValue({ data: { resultado: "ok", inscritos: 0 }, error: null });
    expect(await alterarVagas("s-outra", {}, form({ vagas: "15" }))).toEqual({ ok: true });
  });
});

describe("cancelarSessao", () => {
  it("vendedor cancela a sessão vazia dele (pela função que confere os inscritos na hora)", async () => {
    rpc.mockResolvedValue({ data: "ok", error: null });
    expect(await cancelarSessao("s-minha")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("cancelar_sessao_vazia", { p_sessao: "s-minha" });
  });
  it("vendedor não cancela sessão com inscritos", async () => {
    rpc.mockResolvedValue({ data: "tem_inscritos", error: null });
    expect(await cancelarSessao("s-minha")).toEqual({ erro: "Essa sessão tem inscritos. Só o admin pode cancelar." });
  });
  it("vendedor não cancela sessão de outra agenda", async () => {
    expect(await cancelarSessao("s-outra")).toEqual({ erro: SO_GESTOR });
    expect(rpc).not.toHaveBeenCalled();
    expect(f.tabelas.sessoes[1].status).toBe("agendada");
  });
  it("admin cancela com inscritos, como antes (e as inscrições agendadas viram canceladas)", async () => {
    eu = ADMIN;
    f.tabelas.inscricoes.push({ id: "i1", sessao_id: "s-outra", status: "agendado" });
    expect(await cancelarSessao("s-outra")).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
    expect(f.tabelas.sessoes[1].status).toBe("cancelada");
    expect(f.tabelas.inscricoes[0].status).toBe("cancelado");
  });
});

describe("permissões", () => {
  const SEM_PERMISSAO = "Você não tem permissão pra isso. Fale com o admin.";

  it("sem horarios: o vendedor não cria, não para, não muda vagas nem cancela, nem na agenda dele", async () => {
    eu = { ...VENDEDOR, permissoes: { horarios: false } };
    expect(await criarSessao({}, form({ agenda_id: MINHA, inicio: "2099-01-02T10:00", vagas: "12" }))).toEqual({ erro: SEM_PERMISSAO });
    expect(await criarRepeticao({}, form({ agenda_id: MINHA, dias: ["1"], hora: "19:00", vagas: "20", ate: "" }))).toEqual({ erro: SEM_PERMISSAO });
    expect(await pararRepeticao("r-minha")).toEqual({ erro: SEM_PERMISSAO });
    expect(await alterarVagas("s-minha", {}, form({ vagas: "15" }))).toEqual({ erro: SEM_PERMISSAO });
    expect(await cancelarSessao("s-minha")).toEqual({ erro: SEM_PERMISSAO });
    expect(f.tabelas.sessoes).toHaveLength(2);
    expect(f.tabelas.repeticoes.map((r) => r.ativa)).toEqual([true, true]);
    expect(rpc).not.toHaveBeenCalled();
    expect(gerar).not.toHaveBeenCalled();
  });

  it("todas_agendas (só leitura): continua sem mexer nos horários de outra agenda", async () => {
    eu = { ...VENDEDOR, permissoes: { todas_agendas: true } };
    expect(await criarSessao({}, form({ agenda_id: OUTRA, inicio: "2099-01-02T10:00", vagas: "12" }))).toEqual({ erro: SO_GESTOR });
    expect(await pararRepeticao("r-outra")).toEqual({ erro: SO_GESTOR });
    expect(await alterarVagas("s-outra", {}, form({ vagas: "15" }))).toEqual({ erro: SO_GESTOR });
    expect(await cancelarSessao("s-outra")).toEqual({ erro: SO_GESTOR });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("admin com horarios desligado no jsonb segue mexendo", async () => {
    eu = { ...ADMIN, permissoes: { horarios: false } };
    expect(await pararRepeticao("r-outra")).toEqual({ ok: true });
  });
});
