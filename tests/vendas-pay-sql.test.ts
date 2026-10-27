import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

let db: PGlite;
let agenda: string;
let seq = 0;

async function sessao(inicio: string, status = "encerrada"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into sessoes (agenda_id, inicio, vagas, status, titulo) values ($1, $2, 30, $3, 'Call') returning id",
    [agenda, inicio, status],
  );
  return rows[0].id;
}

async function inscricao(sessaoId: string, whatsapp: string, email: string | null, status = "compareceu"): Promise<string> {
  seq++;
  const codigo = `c${String(seq).padStart(9, "0")}`;
  const { rows } = await db.query<{ id: string }>(
    "insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp, email, status) values ($1, $2, $3, 'Lead', $4, $5, $6) returning id",
    [sessaoId, agenda, codigo, whatsapp, email, status],
  );
  return rows[0].id;
}

async function presenca(sessaoId: string, inscricaoId: string, entrou: string) {
  seq++;
  await db.query("insert into presencas (sessao_id, inscricao_id, peer_id, entrou_em) values ($1, $2, $3, $4)", [sessaoId, inscricaoId, `p${seq}`, entrou]);
}

async function registrar(
  orderId: string,
  status: "aprovada" | "reembolsada",
  comprada: string,
  opts: { valor?: number; email?: string | null; whatsapp?: string | null; produto?: string | null } = {},
) {
  await db.query(
    "select registrar_venda($1, $2, $3, $4, $5, $6, $7, $8)",
    [orderId, status, opts.valor ?? 1000, opts.produto ?? null, opts.email ?? null, opts.whatsapp ?? null, comprada, {}],
  );
}

async function venda(orderId: string) {
  const { rows } = await db.query<{ status: string; inscricao_id: string | null; sessao_id: string | null; valor_centavos: number; produto: string | null }>(
    "select status, inscricao_id, sessao_id, valor_centavos, produto from vendas where order_id = $1",
    [orderId],
  );
  return rows[0] ?? null;
}

beforeEach(async () => {
  db = await bancoComMigracoes();
  const { rows } = await db.query<{ id: string }>("insert into agendas (nome, slug, duracao_min) values ('Vendas', 'vendas', 60) returning id");
  agenda = rows[0].id;
});

describe("registrar_venda: compra aprovada", () => {
  it("sem telefone nem e-mail que batam: insere sem vínculo", async () => {
    await registrar("o1", "aprovada", "2026-10-23T12:00:00Z", { whatsapp: "+551130000000" });
    expect(await venda("o1")).toEqual(
      expect.objectContaining({ status: "aprovada", inscricao_id: null, sessao_id: null, valor_centavos: 1000 }),
    );
  });

  it("liga pelo WhatsApp quando a sessão começou dentro dos 7 dias antes da compra", async () => {
    const s = await sessao("2026-10-20T12:00:00Z");
    const i = await inscricao(s, "+551138887777", "ana@x.com");
    await registrar("o2", "aprovada", "2026-10-23T12:00:00Z", { whatsapp: "+551138887777" });
    expect(await venda("o2")).toEqual(expect.objectContaining({ inscricao_id: i, sessao_id: s }));
  });

  it("sessão fora da janela de 7 dias (antes): não liga", async () => {
    await sessao("2026-10-10T12:00:00Z");
    const s2 = await sessao("2026-10-10T12:00:00Z");
    await inscricao(s2, "+551138887777", "ana@x.com");
    await registrar("o3", "aprovada", "2026-10-23T12:00:00Z", { whatsapp: "+551138887777" });
    expect((await venda("o3"))?.inscricao_id).toBeNull();
  });

  it("sessão depois da compra: não liga (comprada antes de assistir não conta)", async () => {
    const s = await sessao("2026-10-24T12:00:00Z");
    await inscricao(s, "+551138887777", "ana@x.com");
    await registrar("o4", "aprovada", "2026-10-23T12:00:00Z", { whatsapp: "+551138887777" });
    expect((await venda("o4"))?.inscricao_id).toBeNull();
  });

  it("sem telefone batendo, cai pro e-mail (sem diferenciar caixa)", async () => {
    const s = await sessao("2026-10-20T12:00:00Z");
    const i = await inscricao(s, "+551137776666", "Ana@X.com");
    await registrar("o5", "aprovada", "2026-10-23T12:00:00Z", { whatsapp: "+551138887777", email: "ANA@x.COM" });
    expect(await venda("o5")).toEqual(expect.objectContaining({ inscricao_id: i, sessao_id: s }));
  });

  it("telefone batendo tem prioridade sobre o e-mail", async () => {
    const sTel = await sessao("2026-10-21T12:00:00Z");
    const iTel = await inscricao(sTel, "+551138887777", "outro@x.com");
    const sEmail = await sessao("2026-10-22T12:00:00Z");
    await inscricao(sEmail, "+551130000000", "ana@x.com");
    await registrar("o6", "aprovada", "2026-10-23T12:00:00Z", { whatsapp: "+551138887777", email: "ana@x.com" });
    expect((await venda("o6"))?.inscricao_id).toBe(iTel);
  });

  it("não compareceu (agendado/faltou/cancelado): não liga", async () => {
    const s = await sessao("2026-10-20T12:00:00Z");
    await inscricao(s, "+551138887777", "ana@x.com", "faltou");
    await registrar("o7", "aprovada", "2026-10-23T12:00:00Z", { whatsapp: "+551138887777" });
    expect((await venda("o7"))?.inscricao_id).toBeNull();
  });

  it("várias sessões assistidas: liga na mais recente (mais perto da compra)", async () => {
    const sVelha = await sessao("2026-10-18T12:00:00Z");
    await inscricao(sVelha, "+551138887777", "ana@x.com");
    const sNova = await sessao("2026-10-22T12:00:00Z");
    const iNova = await inscricao(sNova, "+551138887777", "ana@x.com");
    await registrar("o8", "aprovada", "2026-10-23T12:00:00Z", { whatsapp: "+551138887777" });
    expect((await venda("o8"))?.inscricao_id).toBe(iNova);
  });

  it("order_id repetido: atualiza em vez de duplicar (upsert)", async () => {
    await registrar("o9", "aprovada", "2026-10-23T12:00:00Z", { valor: 1000, produto: "A" });
    await registrar("o9", "aprovada", "2026-10-23T12:00:00Z", { valor: 2000, produto: "B" });
    const { rows } = await db.query("select * from vendas where order_id = 'o9'");
    expect(rows).toHaveLength(1);
    expect(await venda("o9")).toEqual(expect.objectContaining({ valor_centavos: 2000, produto: "B" }));
  });
});

describe("registrar_venda: quem compra durante a oferta (ainda 'agendado')", () => {
  it("agendado com presença na sessão: liga", async () => {
    const s = await sessao("2026-10-23T11:00:00Z", "ao_vivo");
    const i = await inscricao(s, "+551138887777", "ana@x.com", "agendado");
    await presenca(s, i, "2026-10-23T11:02:00Z");
    await registrar("a1", "aprovada", "2026-10-23T11:50:00Z", { whatsapp: "+551138887777" });
    expect(await venda("a1")).toEqual(expect.objectContaining({ inscricao_id: i, sessao_id: s }));
  });

  it("agendado com presença, casando pelo e-mail: liga", async () => {
    const s = await sessao("2026-10-23T11:00:00Z", "ao_vivo");
    const i = await inscricao(s, "+551137776666", "ana@x.com", "agendado");
    await presenca(s, i, "2026-10-23T11:02:00Z");
    await registrar("a2", "aprovada", "2026-10-23T11:50:00Z", { email: "ANA@x.com" });
    expect((await venda("a2"))?.inscricao_id).toBe(i);
  });

  it("agendado sem presença: não liga", async () => {
    const s = await sessao("2026-10-23T11:00:00Z", "ao_vivo");
    await inscricao(s, "+551138887777", "ana@x.com", "agendado");
    await registrar("a3", "aprovada", "2026-10-23T11:50:00Z", { whatsapp: "+551138887777" });
    expect((await venda("a3"))?.inscricao_id).toBeNull();
  });

  it("cancelado com presença: não liga", async () => {
    const s = await sessao("2026-10-23T11:00:00Z", "ao_vivo");
    const i = await inscricao(s, "+551138887777", "ana@x.com", "cancelado");
    await presenca(s, i, "2026-10-23T11:02:00Z");
    await registrar("a4", "aprovada", "2026-10-23T11:50:00Z", { whatsapp: "+551138887777" });
    expect((await venda("a4"))?.inscricao_id).toBeNull();
  });
});

describe("religar_vendas", () => {
  async function religar(inscricaoId: string): Promise<number> {
    const { rows } = await db.query<{ n: number }>("select religar_vendas($1) as n", [inscricaoId]);
    return rows[0].n;
  }

  it("venda sem vínculo de quem virou compareceu: liga (WhatsApp ou e-mail)", async () => {
    const s = await sessao("2026-10-23T11:00:00Z");
    const i = await inscricao(s, "+551138887777", "ana@x.com", "agendado");
    await registrar("l1", "aprovada", "2026-10-23T11:50:00Z", { whatsapp: "+551138887777" });
    await registrar("l2", "aprovada", "2026-10-24T11:50:00Z", { email: "Ana@X.com" });
    expect((await venda("l1"))?.inscricao_id).toBeNull();
    await db.query("update inscricoes set status = 'compareceu' where id = $1", [i]);
    expect(await religar(i)).toBe(2);
    expect(await venda("l1")).toEqual(expect.objectContaining({ inscricao_id: i, sessao_id: s }));
    expect((await venda("l2"))?.inscricao_id).toBe(i);
  });

  it("não mexe em venda já ligada, fora da janela, de outra pessoa nem de quem não veio", async () => {
    const sVelha = await sessao("2026-10-20T12:00:00Z");
    const iVelha = await inscricao(sVelha, "+551138887777", "ana@x.com");
    const s = await sessao("2026-10-23T11:00:00Z");
    const i = await inscricao(s, "+551138887777", "ana@x.com", "agendado");
    await registrar("m1", "aprovada", "2026-10-21T12:00:00Z", { whatsapp: "+551138887777" }); // ligada na velha
    await registrar("m2", "aprovada", "2026-10-31T12:00:00Z", { whatsapp: "+551138887777" }); // > 7 dias depois
    await registrar("m3", "aprovada", "2026-10-23T11:30:00Z", { whatsapp: "+551130000000" }); // outra pessoa
    expect(await religar(i)).toBe(0); // ainda agendado e sem presença
    await db.query("update inscricoes set status = 'compareceu' where id = $1", [i]);
    expect(await religar(i)).toBe(0);
    expect((await venda("m1"))?.inscricao_id).toBe(iVelha);
    expect((await venda("m2"))?.inscricao_id).toBeNull();
    expect((await venda("m3"))?.inscricao_id).toBeNull();
  });

  it("anônimo e equipe logada não executam (só o servidor)", async () => {
    const { rows } = await db.query<{ anon: boolean; auth: boolean; srv: boolean }>(
      `select has_function_privilege('anon', 'public.religar_vendas(uuid)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.religar_vendas(uuid)', 'execute') as auth,
              has_function_privilege('service_role', 'public.religar_vendas(uuid)', 'execute') as srv`,
    );
    expect(rows[0]).toEqual({ anon: false, auth: false, srv: true });
  });
});

describe("registrar_venda: reembolso", () => {
  it("venda já aprovada: reembolso marca o status, mantendo o vínculo", async () => {
    const s = await sessao("2026-10-20T12:00:00Z");
    const i = await inscricao(s, "+551138887777", "ana@x.com");
    await registrar("r1", "aprovada", "2026-10-23T12:00:00Z", { whatsapp: "+551138887777" });
    await registrar("r1", "reembolsada", "2026-10-23T12:00:00Z", { whatsapp: "+551138887777" });
    expect(await venda("r1")).toEqual(expect.objectContaining({ status: "reembolsada", inscricao_id: i, sessao_id: s }));
  });

  it("reembolso sem venda aprovada antes (fora de ordem): insere direto como reembolsada", async () => {
    await registrar("r2", "reembolsada", "2026-10-23T12:00:00Z", { whatsapp: "+551130000000" });
    expect((await venda("r2"))?.status).toBe("reembolsada");
  });
});
