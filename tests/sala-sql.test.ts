import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

let db: PGlite;
let sessao: string;

beforeEach(async () => {
  db = await bancoComMigracoes();
  const ag = (await db.query<{ id: string }>("insert into agendas (nome, slug) values ('V', 'v') returning id")).rows[0].id;
  sessao = (await db.query<{ id: string }>("insert into sessoes (agenda_id, inicio, vagas) values ($1, now() + interval '1 day', 10) returning id", [ag])).rows[0].id;
});

describe("reservar_meeting", () => {
  it("grava a meeting na primeira vez e devolve a mesma depois", async () => {
    const a = (await db.query<{ m: string }>("select reservar_meeting($1, 'm1') as m", [sessao])).rows[0].m;
    const b = (await db.query<{ m: string }>("select reservar_meeting($1, 'm2') as m", [sessao])).rows[0].m;
    expect(a).toBe("m1");
    expect(b).toBe("m1");
  });
});

describe("tabelas da sala", () => {
  it("gravacoes e webhook_recebidos existem com RLS", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('gravacoes','webhook_recebidos') order by 1",
    );
    expect(rows).toEqual([{ relname: "gravacoes", relrowsecurity: true }, { relname: "webhook_recebidos", relrowsecurity: true }]);
  });
  it("gravacoes aceita qualquer status do RealtimeKit (PAUSED, INVOKED...)", async () => {
    await db.query("insert into gravacoes (rtk_recording_id, status) values ('r1', 'PAUSED'), ('r2', 'INVOKED')");
    const { rows } = await db.query<{ status: string }>("select status from gravacoes order by rtk_recording_id");
    expect(rows.map((r) => r.status)).toEqual(["PAUSED", "INVOKED"]);
  });
  it("passes_rtk: RLS ligada, sem policies, chave (custom_id, meeting_id)", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'passes_rtk'");
    expect(rows).toEqual([{ relrowsecurity: true }]);
    const pol = await db.query<{ total: number }>("select count(*)::int as total from pg_policies where tablename = 'passes_rtk'");
    expect(pol.rows[0].total).toBe(0);
    await db.query("insert into passes_rtk (custom_id, meeting_id, participant_id) values ('c', 'm', 'p1')");
    await expect(db.query("insert into passes_rtk (custom_id, meeting_id, participant_id) values ('c', 'm', 'p2')")).rejects.toThrow();
    await db.query("insert into passes_rtk (custom_id, meeting_id, participant_id) values ('c', 'm2', 'p3')");
  });
  it("rtk_meeting_id é único", async () => {
    await db.query("update sessoes set rtk_meeting_id = 'x' where id = $1", [sessao]);
    const ag = (await db.query<{ id: string }>("select agenda_id as id from sessoes where id = $1", [sessao])).rows[0].id;
    await expect(db.query("insert into sessoes (agenda_id, inicio, vagas, rtk_meeting_id) values ($1, now(), 1, 'x')", [ag])).rejects.toThrow();
  });
});
