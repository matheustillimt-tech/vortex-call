import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { bancoComMigracoes } from "./banco";

// Horários pelo vendedor (migração 20261023220000_horarios.sql): cancelar só sessão vazia e mudar vagas sem ficar
// abaixo dos inscritos, de forma atômica (funções do servidor); e a trava que impede o membro de cancelar, pelo
// cliente dele, uma sessão que tem inscritos.
const GABRIEL = "11111111-1111-4111-8111-111111111111";
const HUGO = "22222222-2222-4222-8222-222222222222";

let db: PGlite;
let ids: Record<string, string>;
let seq = 0;

async function um<T = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, p)).rows[0];
}
async function comoLogado(uid: string) {
  await db.query("select set_config('app.uid', $1, false)", [uid]);
  await db.exec("set role authenticated");
}
async function comoServidor() {
  await db.exec("reset role");
  await db.query("select set_config('app.uid', '', false)");
}
async function sessao(agenda: string, vagas = 10): Promise<string> {
  return (await um<{ id: string }>("insert into sessoes (agenda_id, inicio, vagas) values ($1, now() + interval '1 day', $2) returning id", [agenda, vagas])).id;
}
async function inscrever(sessaoId: string, agenda: string, status = "agendado"): Promise<void> {
  seq++;
  await db.query("insert into inscricoes (sessao_id, agenda_id, codigo, nome, whatsapp, status) values ($1, $2, $3, 'Lead', $4, $5)", [
    sessaoId, agenda, `h${String(seq).padStart(9, "0")}`, `+55119000${String(seq).padStart(5, "0")}`, status,
  ]);
}
async function status(sessaoId: string): Promise<string> {
  return (await um<{ status: string }>("select status from sessoes where id = $1", [sessaoId])).status;
}

beforeEach(async () => {
  db = await bancoComMigracoes({ privilegiosSupabase: true });
  await db.query("insert into auth.users (id, email) values ($1, 'g@x.com'), ($2, 'h@x.com')", [GABRIEL, HUGO]);
  const u = async (auth: string, nome: string, papel: string) =>
    (await um<{ id: string }>("insert into usuarios (auth_id, nome, email, papel) values ($1, $2, $3, $4) returning id", [auth, nome, `${nome}@x.com`, papel])).id;
  ids = { gabriel: await u(GABRIEL, "Gabriel", "admin"), hugo: await u(HUGO, "Hugo", "membro") };
  ids.agenda = (await um<{ id: string }>("insert into agendas (nome, slug, responsavel_id) values ('Impl', 'impl', $1) returning id", [ids.hugo])).id;
});

describe("cancelar_sessao_vazia", () => {
  it("cancela sessão agendada sem inscritos ativos (inscrição cancelada não conta)", async () => {
    const s = await sessao(ids.agenda);
    await inscrever(s, ids.agenda, "cancelado");
    expect((await um<{ r: string }>("select public.cancelar_sessao_vazia($1) as r", [s])).r).toBe("ok");
    expect(await status(s)).toBe("cancelada");
  });

  it("recusa com inscrito ativo e não mexe em nada", async () => {
    const s = await sessao(ids.agenda);
    await inscrever(s, ids.agenda);
    expect((await um<{ r: string }>("select public.cancelar_sessao_vazia($1) as r", [s])).r).toBe("tem_inscritos");
    expect(await status(s)).toBe("agendada");
  });

  it("sessão que não está agendada ou não existe", async () => {
    const s = await sessao(ids.agenda);
    await db.query("update sessoes set status = 'ao_vivo' where id = $1", [s]);
    expect((await um<{ r: string }>("select public.cancelar_sessao_vazia($1) as r", [s])).r).toBe("nao_agendada");
    expect((await um<{ r: string }>("select public.cancelar_sessao_vazia($1) as r", ["fafafafa-fafa-4faf-8faf-fafafafafafa"])).r).toBe("nao_encontrada");
  });

  it("só o servidor chama (a equipe não executa a função)", async () => {
    const s = await sessao(ids.agenda);
    await comoLogado(HUGO);
    await expect(db.query("select public.cancelar_sessao_vazia($1)", [s])).rejects.toThrow();
    await comoServidor();
  });
});

describe("alterar_vagas_sessao", () => {
  it("muda as vagas quando não fica abaixo dos inscritos ativos", async () => {
    const s = await sessao(ids.agenda, 10);
    await inscrever(s, ids.agenda);
    await inscrever(s, ids.agenda);
    await inscrever(s, ids.agenda, "cancelado");
    expect((await um<{ r: unknown }>("select public.alterar_vagas_sessao($1, 2) as r", [s])).r).toEqual({ resultado: "ok", inscritos: 2 });
    expect((await um<{ vagas: number }>("select vagas from sessoes where id = $1", [s])).vagas).toBe(2);
  });

  it("recusa abaixo dos inscritos, fora de 1 a 500 e sessão que não está agendada", async () => {
    const s = await sessao(ids.agenda, 10);
    await inscrever(s, ids.agenda);
    await inscrever(s, ids.agenda);
    await inscrever(s, ids.agenda);
    expect((await um<{ r: unknown }>("select public.alterar_vagas_sessao($1, 2) as r", [s])).r).toEqual({ resultado: "abaixo_inscritos", inscritos: 3 });
    expect((await um<{ r: unknown }>("select public.alterar_vagas_sessao($1, 0) as r", [s])).r).toEqual({ resultado: "invalida", inscritos: 0 });
    expect((await um<{ r: unknown }>("select public.alterar_vagas_sessao($1, 501) as r", [s])).r).toEqual({ resultado: "invalida", inscritos: 0 });
    expect((await um<{ vagas: number }>("select vagas from sessoes where id = $1", [s])).vagas).toBe(10);
    await db.query("update sessoes set status = 'encerrada' where id = $1", [s]);
    expect((await um<{ r: { resultado: string } }>("select public.alterar_vagas_sessao($1, 20) as r", [s])).r.resultado).toBe("nao_agendada");
  });

  it("só o servidor chama", async () => {
    const s = await sessao(ids.agenda);
    await comoLogado(HUGO);
    await expect(db.query("select public.alterar_vagas_sessao($1, 5)", [s])).rejects.toThrow();
    await comoServidor();
  });
});

describe("trava do cancelamento pelo cliente da equipe", () => {
  it("membro não cancela, pelo cliente dele, sessão da agenda dele que tem inscrito ativo", async () => {
    const s = await sessao(ids.agenda);
    await inscrever(s, ids.agenda);
    await comoLogado(HUGO);
    await expect(db.query("update sessoes set status = 'cancelada' where id = $1", [s])).rejects.toThrow(/Só o admin pode cancelar/);
    await comoServidor();
    expect(await status(s)).toBe("agendada");
  });

  it("membro cancela pelo cliente dele a sessão vazia; admin e servidor cancelam com inscritos (como antes)", async () => {
    const vazia = await sessao(ids.agenda);
    const cheia1 = await sessao(ids.agenda);
    const cheia2 = await sessao(ids.agenda);
    await inscrever(cheia1, ids.agenda);
    await inscrever(cheia2, ids.agenda);
    await comoLogado(HUGO);
    await db.query("update sessoes set status = 'cancelada' where id = $1", [vazia]);
    await comoLogado(GABRIEL);
    await db.query("update sessoes set status = 'cancelada' where id = $1", [cheia1]);
    await comoServidor();
    await db.query("update sessoes set status = 'cancelada' where id = $1", [cheia2]);
    expect([await status(vazia), await status(cheia1), await status(cheia2)]).toEqual(["cancelada", "cancelada", "cancelada"]);
  });

  it("a trava não atrapalha o membro nas outras mudanças de status (abrir a sala, encerrar)", async () => {
    const s = await sessao(ids.agenda);
    await inscrever(s, ids.agenda);
    await comoLogado(HUGO);
    await db.query("update sessoes set status = 'ao_vivo' where id = $1", [s]);
    await comoServidor();
    expect(await status(s)).toBe("ao_vivo");
  });
});
