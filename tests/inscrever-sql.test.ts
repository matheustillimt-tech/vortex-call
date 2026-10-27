import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

let db: PGlite;
let agenda: string;
let sessaoA: string;
let sessaoB: string;

async function inscrever(sessao: string, codigo: string, whatsapp: string) {
  const { rows } = await db.query<{ resultado: string; inscricao_id: string; codigo: string }>(
    "select * from inscrever($1, $2, 'Lead', $3, null, null, null, '{}'::jsonb, 'pagina')",
    [sessao, codigo, whatsapp],
  );
  return rows[0];
}

beforeEach(async () => {
  db = await bancoComMigracoes();
  agenda = (await db.query<{ id: string }>("insert into agendas (nome, slug) values ('Vendas', 'vendas') returning id")).rows[0].id;
  sessaoA = (
    await db.query<{ id: string }>("insert into sessoes (agenda_id, inicio, vagas) values ($1, now() + interval '2 days', 2) returning id", [agenda])
  ).rows[0].id;
  sessaoB = (
    await db.query<{ id: string }>("insert into sessoes (agenda_id, inicio, vagas) values ($1, now() + interval '3 days', 2) returning id", [agenda])
  ).rows[0].id;
});

describe("inscrever", () => {
  it("aceita origem painel (agendamento manual da aba Agendas)", async () => {
    const { rows } = await db.query<{ resultado: string; inscricao_id: string }>(
      "select * from inscrever($1, 'pppppppppp', 'Lead', '+551130000009', null, null, null, '{}'::jsonb, 'painel')",
      [sessaoA],
    );
    expect(rows[0].resultado).toBe("nova");
    const { rows: i } = await db.query<{ origem: string }>("select origem from inscricoes where id = $1", [rows[0].inscricao_id]);
    expect(i[0].origem).toBe("painel");
  });

  it("inscreve e devolve o código", async () => {
    const r = await inscrever(sessaoA, "aaaaaaaaaa", "+551130000001");
    expect(r.resultado).toBe("nova");
    expect(r.codigo).toBe("aaaaaaaaaa");
  });

  it("mesmo WhatsApp na mesma sessão devolve a inscrição que já existe", async () => {
    const a = await inscrever(sessaoA, "aaaaaaaaaa", "+551130000001");
    const b = await inscrever(sessaoA, "bbbbbbbbbb", "+551130000001");
    expect(b.resultado).toBe("mesma");
    expect(b.inscricao_id).toBe(a.inscricao_id);
    expect(b.codigo).toBe("aaaaaaaaaa");
  });

  it("mesmo WhatsApp em outra sessão da agenda vira reagendamento com o mesmo código", async () => {
    const a = await inscrever(sessaoA, "aaaaaaaaaa", "+551130000001");
    const b = await inscrever(sessaoB, "bbbbbbbbbb", "+551130000001");
    expect(b.resultado).toBe("reagendada");
    expect(b.inscricao_id).toBe(a.inscricao_id);
    expect(b.codigo).toBe("aaaaaaaaaa");
    const { rows } = await db.query<{ sessao_id: string }>("select sessao_id from inscricoes where id = $1", [a.inscricao_id]);
    expect(rows[0].sessao_id).toBe(sessaoB);
  });

  it("reagendar não troca o nome original (alguém que sabe o WhatsApp não consegue renomear o lead)", async () => {
    const { rows: ins } = await db.query<{ id: string; nome: string }>(
      "insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp) values ($1, $2, 'aaaaaaaaaa', 'Original', '+551130000001') returning id, nome",
      [sessaoA, agenda],
    );
    await db.query(
      "select * from inscrever($1, $2, 'Outro Nome', $3, null, null, null, '{}'::jsonb, 'pagina')",
      [sessaoB, "bbbbbbbbbb", "+551130000001"],
    );
    const { rows } = await db.query<{ nome: string }>("select nome from inscricoes where id = $1", [ins[0].id]);
    expect(rows[0].nome).toBe("Original");
  });

  it("não passa do limite de vagas", async () => {
    await inscrever(sessaoA, "aaaaaaaaaa", "+551130000001");
    await inscrever(sessaoA, "bbbbbbbbbb", "+551130000002");
    const c = await inscrever(sessaoA, "cccccccccc", "+551130000003");
    expect(c.resultado).toBe("lotada");
    expect(c.inscricao_id).toBeNull();
  });

  it("recusa sessão cancelada ou que já começou", async () => {
    await db.query("update sessoes set status = 'cancelada' where id = $1", [sessaoA]);
    expect((await inscrever(sessaoA, "aaaaaaaaaa", "+551130000001")).resultado).toBe("indisponivel");
    await db.query("update sessoes set inicio = now() - interval '1 minute' where id = $1", [sessaoB]);
    expect((await inscrever(sessaoB, "bbbbbbbbbb", "+551130000001")).resultado).toBe("indisponivel");
  });

  it("reagendar pra sessão lotada devolve 'lotada' e mantém a inscrição na sessão original", async () => {
    const a = await inscrever(sessaoA, "aaaaaaaaaa", "+551130000001");
    await inscrever(sessaoB, "bbbbbbbbbb", "+551130000002");
    await inscrever(sessaoB, "cccccccccc", "+551130000003");
    const r = await inscrever(sessaoB, "dddddddddd", "+551130000001");
    expect(r.resultado).toBe("lotada");
    expect(r.inscricao_id).toBeNull();
    const { rows } = await db.query<{ sessao_id: string }>("select sessao_id from inscricoes where id = $1", [a.inscricao_id]);
    expect(rows[0].sessao_id).toBe(sessaoA);
  });

  it("índice parcial rejeita duas inscrições 'agendado' do mesmo WhatsApp na agenda, mas permite quando a primeira está cancelada", async () => {
    await inscrever(sessaoA, "aaaaaaaaaa", "+551130000001");
    await expect(
      db.query(
        "insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp) values ($1, $2, 'eeeeeeeeee', 'Lead', '+551130000001')",
        [sessaoB, agenda],
      ),
    ).rejects.toThrow();
    await db.query("update inscricoes set status = 'cancelado' where codigo = 'aaaaaaaaaa'");
    await expect(
      db.query(
        "insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp) values ($1, $2, 'eeeeeeeeee', 'Lead', '+551130000001')",
        [sessaoB, agenda],
      ),
    ).resolves.toBeDefined();
  });

  it("pessoa com inscrição em sessão passada consegue agendar de novo (vira 'faltou')", async () => {
    const a = await inscrever(sessaoA, "aaaaaaaaaa", "+551130000001");
    await db.query("update sessoes set inicio = now() - interval '1 minute' where id = $1", [sessaoA]);
    const b = await inscrever(sessaoB, "bbbbbbbbbb", "+551130000001");
    expect(b.resultado).toBe("nova");
    expect(b.inscricao_id).not.toBe(a.inscricao_id);
    const { rows } = await db.query<{ status: string }>("select status from inscricoes where id = $1", [a.inscricao_id]);
    expect(rows[0].status).toBe("faltou");
  });

  it("pessoa com inscrição em sessão cancelada consegue agendar de novo (vira 'cancelado')", async () => {
    const a = await inscrever(sessaoA, "aaaaaaaaaa", "+551130000001");
    await db.query("update sessoes set status = 'cancelada' where id = $1", [sessaoA]);
    const b = await inscrever(sessaoB, "bbbbbbbbbb", "+551130000001");
    expect(b.resultado).toBe("nova");
    expect(b.inscricao_id).not.toBe(a.inscricao_id);
    const { rows } = await db.query<{ status: string }>("select status from inscricoes where id = $1", [a.inscricao_id]);
    expect(rows[0].status).toBe("cancelado");
  });

  it("vitrine_agenda conta só inscrições ativas", async () => {
    await inscrever(sessaoA, "aaaaaaaaaa", "+551130000001");
    await inscrever(sessaoA, "bbbbbbbbbb", "+551130000002");
    await db.query("update inscricoes set status = 'cancelado' where codigo = 'bbbbbbbbbb'");
    const { rows } = await db.query<{ id: string; inscritos: number }>("select id, inscritos from vitrine_agenda('vendas') order by inicio");
    expect(rows).toEqual([
      { id: sessaoA, inscritos: 1 },
      { id: sessaoB, inscritos: 0 },
    ]);
  });
});
