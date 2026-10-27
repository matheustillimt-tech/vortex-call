import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

let db: PGlite;
beforeAll(async () => {
  db = await bancoComMigracoes();
});

describe("migração inicial", () => {
  it("cria as tabelas das etapas 1 e 2", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    expect(rows.map((r) => r.table_name)).toEqual(["agendas", "alinhamentos", "api_uso", "atividade_lead", "avisos_equipe", "chaves_api", "configuracao", "convites_sessao", "eventos", "fichas", "gravacoes", "inscricoes", "limites", "passes_rtk", "presencas", "repeticoes", "reunioes", "sessoes", "transcricao_trechos", "transcricoes", "usuarios", "vendas", "webhook_recebidos"]);
  });

  it("liga RLS em todas as tabelas", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
    );
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("configuração nasce com uma linha só", async () => {
    const { rows } = await db.query<{ total: number }>("select count(*)::int as total from configuracao");
    expect(rows[0].total).toBe(1);
    await expect(db.query("insert into configuracao (id, nome) values (2, 'x')")).rejects.toThrow();
  });

  it("sessão de repetição não duplica no mesmo horário", async () => {
    const { rows: [a] } = await db.query<{ id: string }>("insert into agendas (nome, slug) values ('Vendas', 'vendas-mig') returning id");
    const { rows: [r] } = await db.query<{ id: string }>(
      "insert into repeticoes (agenda_id, dias_semana, hora, vagas) values ($1, '{2}', '09:00', 30) returning id",
      [a.id],
    );
    await db.query("insert into sessoes (agenda_id, repeticao_id, inicio, vagas) values ($1, $2, '2026-10-27T12:00:00Z', 30)", [a.id, r.id]);
    await expect(
      db.query("insert into sessoes (agenda_id, repeticao_id, inicio, vagas) values ($1, $2, '2026-10-27T12:00:00Z', 30)", [a.id, r.id]),
    ).rejects.toThrow();
  });

  it("rejeita dias_semana vazio", async () => {
    const { rows: [a] } = await db.query<{ id: string }>("insert into agendas (nome, slug) values ('Vendas2', 'vendas-mig-2') returning id");
    await expect(
      db.query("insert into repeticoes (agenda_id, dias_semana, hora, vagas) values ($1, '{}', '09:00', 30)", [a.id]),
    ).rejects.toThrow();
  });

  it("rejeita dias_semana com valor inválido (7)", async () => {
    const { rows: [a] } = await db.query<{ id: string }>("insert into agendas (nome, slug) values ('Vendas3', 'vendas-mig-3') returning id");
    await expect(
      db.query("insert into repeticoes (agenda_id, dias_semana, hora, vagas) values ($1, '{7}', '09:00', 30)", [a.id]),
    ).rejects.toThrow();
  });
});
