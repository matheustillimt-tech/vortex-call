import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SITE = "https://call.exemplo.com.br";
let config: Record<string, unknown> | null = null;
let eu: Record<string, unknown> | null = null;

function query(tabela: string) {
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: tabela === "configuracao" ? config : eu }),
  };
  return q;
}

vi.mock("@/src/lib/supabase/usuario", () => ({
  dbUsuario: async () => ({ from: () => query("x") }),
  exigirAdmin: async () => ({ id: "u-gab", nome: "Gabriel Ramos", papel: "admin" }),
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from: (t: string) => query(t) }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { enviarTesteEquipe } from "@/app/(painel)/configuracoes/actions";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  config = { crm_url_equipe: "https://crm.test/equipe", crm_segredo_equipe: "s3gr3d0" };
  eu = { nome: "Gabriel Ramos", whatsapp: "+551137776666" };
});
afterEach(() => vi.unstubAllGlobals());

describe("enviarTesteEquipe", () => {
  it("manda um novo agendamento de teste pro admin, com o segredo", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect(await enviarTesteEquipe()).toEqual({ status: 200, ok: true });
    const [url, init] = (f.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe("https://crm.test/equipe");
    expect((init.headers as Record<string, string>)["X-Webhook-Secret"]).toBe("s3gr3d0");
    const corpo = JSON.parse(String(init.body));
    expect(corpo.evento).toBe("vendedor_novo_agendamento");
    expect(corpo.id_evento).toMatch(/^teste:vendedor_novo_agendamento:\d+$/);
    expect(corpo.vendedor).toMatchObject({ nome: "Gabriel Ramos", telefone: "551137776666" });
    expect(corpo.mensagem).toContain("Lead: Lead de Teste");
  });

  it("sem URL avisa pra cadastrar", async () => {
    config = { crm_url_equipe: null, crm_segredo_equipe: null };
    await expect(enviarTesteEquipe()).rejects.toThrow("Cadastre a URL antes de enviar o teste.");
  });

  it("admin sem WhatsApp: recusa e não posta nada (número inventado pode ser de alguém)", async () => {
    eu = { nome: "Gabriel Ramos", whatsapp: null };
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    await expect(enviarTesteEquipe()).rejects.toThrow("Cadastre o seu WhatsApp em Equipe");
    expect(f).not.toHaveBeenCalled();
  });

  it("CRM fora do ar: status nulo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("rede"); }));
    expect(await enviarTesteEquipe()).toEqual({ status: null, ok: false });
  });
});
