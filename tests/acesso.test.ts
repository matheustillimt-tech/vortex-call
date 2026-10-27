import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";

let falso = criarDbFalso({});
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => falso.db }));

type M = { id: string; nome: string; papel: "admin" | "membro"; permissoes?: Record<string, boolean> } | null;
let membro: M = null;
vi.mock("@/src/lib/supabase/usuario", () => ({
  exigirMembro: async () => {
    if (!membro) throw new Error("Acesso negado.");
    return membro;
  },
}));
class NaoEncontrado extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NaoEncontrado();
  },
}));

import { exigirAcessoSessao, podeLerSessao, podeVerGravacao, podeVerSessao } from "@/src/lib/acesso";
import { podeVerAgenda } from "@/src/lib/regras/acesso";

const HUGO = { id: "u-hugo", nome: "Hugo", papel: "membro" as const };
const OLAVO = { id: "u-olavo", nome: "Olavo", papel: "membro" as const };
const GABRIEL = { id: "u-gabriel", nome: "Gabriel", papel: "admin" as const };

beforeEach(() => {
  falso = criarDbFalso({
    agendas: [
      { id: "ag-impl", responsavel_id: "u-hugo" },
      { id: "ag-sem", responsavel_id: null },
    ],
    sessoes: [
      { id: "s-impl", agenda_id: "ag-impl" },
      { id: "s-sem", agenda_id: "ag-sem" },
    ],
    gravacoes: [
      { id: "g-impl", sessao_id: "s-impl", reuniao_id: null },
      { id: "g-sem", sessao_id: "s-sem", reuniao_id: null },
      { id: "g-reuniao", sessao_id: null, reuniao_id: "r1" },
    ],
  });
  membro = null;
});

describe("podeVerAgenda (regra)", () => {
  it("admin sempre; membro só sendo o responsável", () => {
    expect(podeVerAgenda(GABRIEL, null)).toBe(true);
    expect(podeVerAgenda(HUGO, "u-hugo")).toBe(true);
    expect(podeVerAgenda(HUGO, "u-olavo")).toBe(false);
    expect(podeVerAgenda(HUGO, null)).toBe(false);
    expect(podeVerAgenda(HUGO, undefined)).toBe(false);
  });
});

describe("podeVerSessao", () => {
  it("o vendedor vê a sessão da agenda dele; o de outra agenda é recusado", async () => {
    expect(await podeVerSessao(HUGO, "s-impl")).toBe(true);
    expect(await podeVerSessao(OLAVO, "s-impl")).toBe(false);
    expect(await podeVerSessao(HUGO, "s-sem")).toBe(false);
    expect(await podeVerSessao(HUGO, "nao-existe")).toBe(false);
  });

  it("admin vê qualquer sessão sem nem consultar", async () => {
    expect(await podeVerSessao(GABRIEL, "s-sem")).toBe(true);
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("podeVerGravacao", () => {
  it("gravação de sessão segue a agenda; de reunião, toda a equipe", async () => {
    expect(await podeVerGravacao(HUGO, "g-impl")).toBe(true);
    expect(await podeVerGravacao(OLAVO, "g-impl")).toBe(false);
    expect(await podeVerGravacao(HUGO, "g-sem")).toBe(false);
    expect(await podeVerGravacao(OLAVO, "g-reuniao")).toBe(true);
    expect(await podeVerGravacao(OLAVO, "nao-existe")).toBe(false);
    expect(await podeVerGravacao(GABRIEL, "g-sem")).toBe(true);
  });
});

describe("exigirAcessoSessao (páginas)", () => {
  it("devolve o membro quando pode e dá 404 quando não pode", async () => {
    membro = HUGO;
    await expect(exigirAcessoSessao("s-impl")).resolves.toEqual(HUGO);
    membro = OLAVO;
    await expect(exigirAcessoSessao("s-impl")).rejects.toBeInstanceOf(NaoEncontrado);
  });
});

describe("permissões (todas_agendas e gravacoes)", () => {
  const OTAVIO_TODAS = { ...OLAVO, permissoes: { todas_agendas: true } as Record<string, boolean> };

  it("todas_agendas: lê sessão de outra agenda, mas não vira gestor (podeVerSessao segue falso)", async () => {
    expect(await podeLerSessao(OLAVO, "s-impl")).toBe(false);
    expect(await podeLerSessao(OTAVIO_TODAS, "s-impl")).toBe(true);
    expect(await podeLerSessao(OTAVIO_TODAS, "nao-existe")).toBe(false);
    expect(await podeVerSessao(OTAVIO_TODAS, "s-impl")).toBe(false);
    expect(await podeLerSessao(HUGO, "s-impl")).toBe(true);
  });

  it("todas_agendas: a página da sessão abre (só leitura)", async () => {
    membro = OTAVIO_TODAS;
    await expect(exigirAcessoSessao("s-impl")).resolves.toEqual(OTAVIO_TODAS);
  });

  it("todas_agendas não abre gravação de outra agenda; sem gravacoes, nenhuma (nem da reunião)", async () => {
    expect(await podeVerGravacao(OTAVIO_TODAS, "g-impl")).toBe(false);
    const semGravacoes = { ...HUGO, permissoes: { gravacoes: false } };
    expect(await podeVerGravacao(semGravacoes, "g-impl")).toBe(false);
    expect(await podeVerGravacao(semGravacoes, "g-reuniao")).toBe(false);
    expect(await podeVerGravacao({ ...GABRIEL, permissoes: { gravacoes: false } }, "g-impl")).toBe(true);
  });
});
