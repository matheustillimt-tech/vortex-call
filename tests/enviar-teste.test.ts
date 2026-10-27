import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SITE = "https://call.exemplo.com.br";
let agenda: Record<string, unknown> | null = null;
let usuario: Record<string, unknown> | null = null;

function query(tabela?: string) {
  const q: Record<string, unknown> = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: tabela === "usuarios" ? usuario : agenda }) };
  return q;
}

vi.mock("@/src/lib/supabase/usuario", () => ({
  dbUsuario: async () => ({ from: () => query() }),
  exigirAdmin: async () => ({ id: "u1", nome: "Admin", papel: "admin" }),
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from: (t: string) => query(t) }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

import { enviarTeste } from "@/app/(painel)/agendas/actions";
import { mensagemPadrao, dadosDoCorpo } from "@/src/lib/regras/mensagem";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_TEXT_MODEL;
  usuario = { whatsapp: "+551137776666" };
  agenda = { slug: "vendas", nome: "Vendas", crm_urls: { faltou: "https://crm.test/hook" }, crm_segredo: null };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const corpoDoCrm = (f: ReturnType<typeof vi.fn>) =>
  JSON.parse(String((f.mock.calls as unknown as [string, RequestInit][]).find(([u]) => u === "https://crm.test/hook")![1].body));

describe("enviarTeste (Lead de Teste)", () => {
  it("o lead do teste é o WhatsApp do admin; sem ele, recusa e não posta nada", async () => {
    const f = vi.fn(async (_url: string) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    await enviarTeste("ag1", "faltou");
    expect(corpoDoCrm(f).lead.whatsapp).toBe("+551137776666");

    f.mockClear();
    usuario = { whatsapp: null };
    await expect(enviarTeste("ag1", "faltou")).rejects.toThrow("Cadastre o seu WhatsApp em Equipe");
    expect(f).not.toHaveBeenCalled();
  });

  it("sem IA: leva a mensagem fixa e os campos", async () => {
    const f = vi.fn(async (_url: string) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);

    expect(await enviarTeste("ag1", "faltou")).toEqual({ status: 200, ok: true });
    const corpo = corpoDoCrm(f);
    expect(corpo.lead.nome).toBe("Lead de Teste");
    expect(corpo.mensagem).toBe(mensagemPadrao("faltou", dadosDoCorpo(corpo)));
    expect(corpo.mensagem).toContain(`${SITE}/agendar/vendas`);
    expect(corpo.campos).toEqual(expect.objectContaining({ call_agenda: "diagnóstico", call_status: "faltou", call_reagendar: `${SITE}/agendar/vendas` }));
  });

  it("com IA configurada leva o texto fixo", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    process.env.OPENROUTER_TEXT_MODEL = "m/1";
    const f = vi.fn(async (_url: string) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);

    await enviarTeste("ag1", "faltou");
    expect(f.mock.calls.some(([url]) => String(url).includes("openrouter.ai"))).toBe(false);
    expect(corpoDoCrm(f).mensagem).toContain(`${SITE}/agendar/vendas`);
  });

});
