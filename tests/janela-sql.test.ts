import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

let db: PGlite;
beforeAll(async () => {
  db = await bancoComMigracoes();
});

describe("agendas.janela_dias", () => {
  it("nasce nulo (sem limite) e aceita de 1 a 60", async () => {
    await db.query("insert into agendas (nome, slug) values ('A', 'janela-a')");
    const { rows } = await db.query<{ janela_dias: number | null }>("select janela_dias from agendas where slug = 'janela-a'");
    expect(rows[0].janela_dias).toBeNull();
    await db.query("update agendas set janela_dias = 1 where slug = 'janela-a'");
    await db.query("update agendas set janela_dias = 60 where slug = 'janela-a'");
    await expect(db.query("update agendas set janela_dias = 0 where slug = 'janela-a'")).rejects.toThrow();
    await expect(db.query("update agendas set janela_dias = 61 where slug = 'janela-a'")).rejects.toThrow();
  });

  it("a equipe (authenticated) pode ler a coluna", async () => {
    const { rows } = await db.query<{ ok: boolean }>("select has_column_privilege('authenticated', 'public.agendas', 'janela_dias', 'select') as ok");
    expect(rows[0].ok).toBe(true);
  });
});

describe("transcrição (agendas.transcrever e sessoes.rtk_transcreve)", () => {
  it("nascem desligadas", async () => {
    await db.query("insert into agendas (nome, slug) values ('T', 'transcricao-a')");
    const { rows } = await db.query<{ transcrever: boolean }>("select transcrever from agendas where slug = 'transcricao-a'");
    expect(rows[0].transcrever).toBe(false);
    const { rows: s } = await db.query<{ d: string | null }>(
      "select column_default as d from information_schema.columns where table_name = 'sessoes' and column_name = 'rtk_transcreve'",
    );
    expect(s[0].d).toBe("false");
  });

  it("a equipe lê a chave da agenda, mas não muda a marca da sessão", async () => {
    const { rows } = await db.query<{ ler: boolean; mudar: boolean }>(
      "select has_column_privilege('authenticated', 'public.agendas', 'transcrever', 'select') as ler, has_column_privilege('authenticated', 'public.sessoes', 'rtk_transcreve', 'update') as mudar",
    );
    expect(rows[0]).toEqual({ ler: true, mudar: false });
  });
});

describe("transcricao_trechos", () => {
  it("a equipe não lê nem grava direto (só o servidor); a mesma fala entra uma vez", async () => {
    const { rows } = await db.query<{ ler: boolean; gravar: boolean }>(
      "select has_table_privilege('authenticated', 'public.transcricao_trechos', 'select') as ler, has_table_privilege('authenticated', 'public.transcricao_trechos', 'insert') as gravar",
    );
    expect(rows[0]).toEqual({ ler: false, gravar: false });
    const { rows: ag } = await db.query<{ id: string }>("insert into agendas (nome, slug) values ('TT', 'trechos-a') returning id");
    const { rows: se } = await db.query<{ id: string }>("insert into sessoes (agenda_id, inicio, vagas) values ($1, now(), 10) returning id", [ag[0].id]);
    const linha = [se[0].id, "t1", "Ana", "Oi", new Date().toISOString()];
    await db.query("insert into transcricao_trechos (sessao_id, rtk_id, falante_nome, texto, falado_em) values ($1, $2, $3, $4, $5)", linha);
    await expect(db.query("insert into transcricao_trechos (sessao_id, rtk_id, falante_nome, texto, falado_em) values ($1, $2, $3, $4, $5)", linha)).rejects.toThrow();
    await db.query("delete from sessoes where id = $1", [se[0].id]);
    const { rows: n } = await db.query<{ n: number }>("select count(*)::int as n from transcricao_trechos");
    expect(n[0].n).toBe(0);
  });

  it("permissão transcricao nasce ligada pro membro", async () => {
    const { rows } = await db.query<{ ok: boolean }>("select permissao_padrao('transcricao') as ok");
    expect(rows[0].ok).toBe(true);
  });
});

describe("alinhamentos", () => {
  it("só o servidor lê e grava; um ao_vivo e um final por sessão", async () => {
    const { rows } = await db.query<{ ler: boolean }>("select has_table_privilege('authenticated', 'public.alinhamentos', 'select') as ler");
    expect(rows[0].ler).toBe(false);
    const { rows: ag } = await db.query<{ id: string }>("insert into agendas (nome, slug) values ('AL', 'alinhamentos-a') returning id");
    const { rows: se } = await db.query<{ id: string }>("insert into sessoes (agenda_id, inicio, vagas) values ($1, now(), 10) returning id", [ag[0].id]);
    const ins = (tipo: string) => db.query("insert into alinhamentos (sessao_id, tipo, origem, dados, texto) values ($1, $2, 'ao_vivo', '{}', 'x')", [se[0].id, tipo]);
    await ins("ao_vivo");
    await ins("final");
    await expect(ins("ao_vivo")).rejects.toThrow();
    await expect(ins("outro")).rejects.toThrow();
  });
});

describe("resumo final (etapa 4)", () => {
  it("evento resumo aceito, fila na sessão, ficha com o resumo e transcricoes só do servidor", async () => {
    const { rows: ag } = await db.query<{ id: string }>("insert into agendas (nome, slug) values ('RF', 'resumo-final-a') returning id");
    const { rows: se } = await db.query<{ id: string }>("insert into sessoes (agenda_id, inicio, vagas) values ($1, now(), 10) returning id", [ag[0].id]);
    await db.query("update sessoes set resumo_estado = 'pendente', resumo_apos = now() where id = $1", [se[0].id]);
    await expect(db.query("update sessoes set resumo_estado = 'outro' where id = $1", [se[0].id])).rejects.toThrow();
    const { rows: chk } = await db.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'eventos_evento_check'");
    expect(chk[0].def).toContain("resumo");
    await db.query("insert into fichas (whatsapp, observacoes_call) values ('+553239990001', 'RESUMO')");
    const { rows: p } = await db.query<{ ler: boolean }>("select has_table_privilege('authenticated', 'public.transcricoes', 'select') as ler");
    expect(p[0].ler).toBe(false);
  });
});
