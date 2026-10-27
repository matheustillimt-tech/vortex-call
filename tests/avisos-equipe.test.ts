import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarDbFalso } from "./db-falso";

type Linha = Record<string, unknown>;
let falso = criarDbFalso({});
const rpc = vi.fn();
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => Object.assign(falso.db, { rpc }) }));

import { avisarNovoAgendamento, enfileirarAvisosEmBreve, enfileirarResumosDiarios, entregarAvisosEquipe } from "@/src/lib/avisos-equipe";

const SITE = "https://call.exemplo.com.br";
const URL_EQUIPE = "https://crm.test/equipe";
let enfileirados: Linha[] = [];
let reivindicados: Linha[] = [];

function banco(extra: Record<string, Linha[]> = {}) {
  falso = criarDbFalso({
    configuracao: [{ id: 1, crm_url_equipe: URL_EQUIPE, crm_segredo_equipe: "s3gr3d0" }],
    usuarios: [
      { id: "u-h", nome: "Hugo Prado", whatsapp: "+551138887777", ativo: true },
      { id: "u-semzap", nome: "Sem Zap", whatsapp: null, ativo: true },
      { id: "u-inativo", nome: "Inativo", whatsapp: "+551130000000", ativo: false },
    ],
    agendas: [
      { id: "ag-impl", nome: "Implementação de IA (grupo)", slug: "implementacao", responsavel_id: "u-h" },
      { id: "ag-sem", nome: "Sem dono", slug: "sem-dono", responsavel_id: null },
      { id: "ag-semzap", nome: "Sem zap", slug: "sem-zap", responsavel_id: "u-semzap" },
      { id: "ag-inativo", nome: "Inativo", slug: "inativo", responsavel_id: "u-inativo" },
    ],
    sessoes: [],
    inscricoes: [],
    fichas: [],
    avisos_equipe: [],
    ...extra,
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  enfileirados = [];
  reivindicados = [];
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string, args: Linha) => {
    if (fn === "enfileirar_aviso_equipe") {
      enfileirados.push(args);
      return { data: true, error: null };
    }
    if (fn === "reivindicar_avisos_equipe") return { data: reivindicados, error: null };
    return { data: null, error: null };
  });
  banco();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("avisarNovoAgendamento", () => {
  function comLead(agenda = "ag-impl") {
    falso.tabelas.sessoes.push({ id: "s1", titulo: null, inicio: "2026-10-23T22:00:00.000Z", agenda_id: agenda, status: "agendada" });
    falso.tabelas.inscricoes.push({
      id: "i1", nome: "Maria Silva", whatsapp: "+551137654321", email: null, sessao_id: "s1", agenda_id: agenda, agendado_em: "2026-10-23T12:00:00.000Z",
      respostas: [{ pergunta: "Área", resposta: "Saúde" }],
    });
  }

  it("enfileira pro responsável com WhatsApp, com o resumo da ficha", async () => {
    comLead();
    falso.tabelas.fichas.push({ whatsapp: "+551137654321", resumo_ia: "Dona de clínica." });
    expect(await avisarNovoAgendamento("i1", false, new Date("2026-10-23T12:00:00Z"))).toBe(true);
    expect(enfileirados).toHaveLength(1);
    const a = enfileirados[0];
    expect(a).toMatchObject({
      p_id_evento: `vendedor_novo_agendamento:i1:s1:${Date.parse("2026-10-23T12:00:00.000Z")}`, p_evento: "vendedor_novo_agendamento", p_usuario: "u-h",
      p_sessao: "s1", p_agenda: "ag-impl", p_inscricao: "i1", p_sem_destino: false,
    });
    const corpo = a.p_corpo as { vendedor: Linha; mensagem: string; dados: Linha };
    expect(corpo.vendedor).toMatchObject({ telefone: "551138887777", nome: "Hugo Prado" });
    expect(corpo.mensagem).toContain("Dona de clínica.");
    expect(corpo.mensagem).toContain(`${SITE}/equipe/sala/s1?modo=anfitriao`);
  });

  it("vendedor sem contato_lead: o aviso leva o WhatsApp e o e-mail do lead mascarados", async () => {
    falso.tabelas.usuarios[0].permissoes = { contato_lead: false };
    comLead();
    falso.tabelas.inscricoes[0].email = "maria@exemplo.com";
    falso.tabelas.fichas.push({ whatsapp: "+551137654321", resumo_ia: "Pediu retorno no 11 3777-6655 ou socio@empresa.com." });
    expect(await avisarNovoAgendamento("i1", false)).toBe(true);
    const corpo = JSON.stringify(enfileirados[0].p_corpo);
    expect(corpo).not.toContain("987654321");
    expect(corpo).not.toContain("maria@exemplo.com");
    expect(corpo).not.toContain("97777-6655");
    expect(corpo).not.toContain("socio@empresa.com");
    expect(corpo).toContain("+55 11 3••••-4321");
    expect(corpo).toContain("m•••@exemplo.com");
  });

  it("vendedor com contato_lead (padrão): número inteiro, como antes", async () => {
    comLead();
    await avisarNovoAgendamento("i1", false);
    expect((enfileirados[0].p_corpo as { mensagem: string }).mensagem).toContain("WhatsApp: +551137654321");
  });

  it("sem ficha usa as respostas do formulário", async () => {
    comLead();
    await avisarNovoAgendamento("i1", true);
    expect((enfileirados[0].p_corpo as { mensagem: string }).mensagem).toContain("Área: Saúde");
  });

  it("não enfileira sem URL da equipe, sem responsável, responsável sem WhatsApp ou desativado", async () => {
    for (const agenda of ["ag-sem", "ag-semzap", "ag-inativo"]) {
      banco();
      comLead(agenda);
      expect(await avisarNovoAgendamento("i1", false), agenda).toBe(false);
    }
    banco();
    comLead();
    falso.tabelas.configuracao[0].crm_url_equipe = null;
    expect(await avisarNovoAgendamento("i1", false)).toBe(false);
    expect(enfileirados).toEqual([]);
  });
});

describe("enfileirarAvisosEmBreve", () => {
  const AGORA = new Date("2026-10-23T21:52:00Z");
  function sessao(id: string, inicio: string, agenda = "ag-impl", status = "agendada") {
    falso.tabelas.sessoes.push({ id, titulo: null, inicio, agenda_id: agenda, status });
  }
  function inscrito(id: string, sessaoId: string, status = "agendado") {
    falso.tabelas.inscricoes.push({ id, sessao_id: sessaoId, status });
  }

  it("avisa só as sessões dos próximos 10 min, com inscrito ativo e responsável com WhatsApp", async () => {
    sessao("perto", "2026-10-23T22:00:00.000Z");
    inscrito("a", "perto");
    inscrito("b", "perto");
    inscrito("c", "perto", "cancelado");
    sessao("vazia", "2026-10-23T22:00:00.000Z");
    inscrito("d", "vazia", "cancelado");
    sessao("longe", "2026-10-23T22:30:00.000Z");
    inscrito("e", "longe");
    sessao("sem-dono", "2026-10-23T22:00:00.000Z", "ag-sem");
    inscrito("f", "sem-dono");
    sessao("cancelada", "2026-10-23T22:00:00.000Z", "ag-impl", "cancelada");
    inscrito("g", "cancelada");
    expect(await enfileirarAvisosEmBreve(AGORA)).toBe(1);
    expect(enfileirados).toHaveLength(1);
    expect(enfileirados[0]).toMatchObject({ p_id_evento: "vendedor_sessao_em_breve:perto", p_usuario: "u-h", p_sessao: "perto" });
    expect((enfileirados[0].p_corpo as { mensagem: string }).mensagem.split("\n")[0]).toBe(
      "Hugo, sua call das 19:00 começa em 8 min, 2 inscritos.",
    );
  });

  it("sem URL da equipe não faz nada", async () => {
    falso.tabelas.configuracao[0].crm_url_equipe = null;
    sessao("perto", "2026-10-23T22:00:00.000Z");
    inscrito("a", "perto");
    expect(await enfileirarAvisosEmBreve(AGORA)).toBe(0);
  });
});

describe("enfileirarResumosDiarios", () => {
  const OITO = new Date("2026-10-23T11:00:00Z"); // 08:00 em Brasília

  beforeEach(() => {
    falso.tabelas.sessoes.push(
      { id: "s-manha", titulo: null, inicio: "2026-10-23T13:00:00.000Z", agenda_id: "ag-impl", status: "agendada" },
      { id: "s-noite", titulo: "Turma B", inicio: "2026-10-23T22:00:00.000Z", agenda_id: "ag-impl", status: "agendada" },
      { id: "s-amanha", titulo: null, inicio: "2026-10-24T13:00:00.000Z", agenda_id: "ag-impl", status: "agendada" },
      { id: "s-cancelada", titulo: null, inicio: "2026-10-23T15:00:00.000Z", agenda_id: "ag-impl", status: "cancelada" },
      { id: "s-sem-dono", titulo: null, inicio: "2026-10-23T15:00:00.000Z", agenda_id: "ag-sem", status: "agendada" },
    );
    falso.tabelas.inscricoes.push({ id: "a", sessao_id: "s-manha", status: "agendado" }, { id: "b", sessao_id: "s-noite", status: "agendado" }, { id: "c", sessao_id: "s-noite", status: "agendado" });
  });

  it("só lista o que ainda vai acontecer hoje", async () => {
    // 09:30 em Brasília: a das 10:00 ainda entra; uma das 07:00 (já passou) não.
    falso.tabelas.sessoes.push({ id: "s-cedo", titulo: null, inicio: "2026-10-23T10:00:00.000Z", agenda_id: "ag-impl", status: "agendada" });
    expect(await enfileirarResumosDiarios(new Date("2026-10-23T12:30:00Z"))).toBe(1);
    const ids = ((enfileirados[0].p_corpo as { dados: { sessoes: { id: string }[] } }).dados.sessoes).map((x) => x.id);
    expect(ids).toEqual(["s-manha", "s-noite"]);
  });

  it("às 08:00 manda um resumo por vendedor com as sessões de hoje", async () => {
    expect(await enfileirarResumosDiarios(OITO)).toBe(1);
    expect(enfileirados[0]).toMatchObject({ p_id_evento: "vendedor_resumo_diario:u-h:2026-10-23", p_usuario: "u-h", p_sessao: null, p_agenda: null });
    const corpo = enfileirados[0].p_corpo as { mensagem: string; dados: { total_sessoes: number; total_inscritos: number } };
    expect(corpo.dados).toMatchObject({ total_sessoes: 2, total_inscritos: 3 });
    expect(corpo.mensagem).toContain("10:00 · Implementação de IA (grupo) · 1 inscrito");
    expect(corpo.mensagem).toContain("19:00 · Turma B · 2 inscritos");
  });

  it("só entram as calls com inscrito; sem nenhuma com inscrito, não sai", async () => {
    falso.tabelas.sessoes.push({ id: "s-vazia", titulo: null, inicio: "2026-10-23T16:00:00.000Z", agenda_id: "ag-impl", status: "agendada" });
    expect(await enfileirarResumosDiarios(OITO)).toBe(1);
    const ids = ((enfileirados[0].p_corpo as { dados: { sessoes: { id: string }[] } }).dados.sessoes).map((x) => x.id);
    expect(ids).toEqual(["s-manha", "s-noite"]);

    enfileirados.length = 0;
    falso.tabelas.avisos_equipe.length = 0;
    falso.tabelas.inscricoes.length = 0;
    expect(await enfileirarResumosDiarios(OITO)).toBe(0);
    expect(enfileirados).toEqual([]);
  });

  it("fora da janela, já enviado hoje ou sem sessão hoje: nada", async () => {
    expect(await enfileirarResumosDiarios(new Date("2026-10-23T10:00:00Z"))).toBe(0);
    falso.tabelas.avisos_equipe.push({ id_evento: "vendedor_resumo_diario:u-h:2026-10-23" });
    expect(await enfileirarResumosDiarios(OITO)).toBe(0);
    banco();
    expect(await enfileirarResumosDiarios(OITO)).toBe(0);
    expect(enfileirados).toEqual([]);
  });
});

describe("entregarAvisosEquipe", () => {
  const AGORA = new Date("2026-10-23T12:00:00Z");
  const aviso = (o: Linha = {}): Linha => ({
    id: "av1", id_evento: "vendedor_sessao_em_breve:s1", evento: "vendedor_sessao_em_breve", usuario_id: "u-h",
    sessao_id: "s1", inscricao_id: null, agenda_id: "ag-impl", tentativas: 0,
    corpo: { evento: "vendedor_sessao_em_breve", id_evento: "vendedor_sessao_em_breve:s1", enviado_em: "2026-10-23T11:00:00.000Z", vendedor: {}, mensagem: "Oi", dados: {} },
    ...o,
  });

  beforeEach(() => {
    falso.tabelas.sessoes.push({ id: "s1", status: "agendada", agenda_id: "ag-impl", inicio: "2026-10-23T12:10:00.000Z" });
    falso.tabelas.avisos_equipe.push({ id: "av1", status: "pendente" });
  });

  it("vendedor desativado ou sem WhatsApp na hora do envio: sem_destino, sem POST", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    for (const usuario of ["u-inativo", "u-semzap", "u-sumiu"]) {
      falso.tabelas.avisos_equipe[0].status = "pendente";
      reivindicados = [aviso({ usuario_id: usuario })];
      await entregarAvisosEquipe(AGORA);
      expect(falso.tabelas.avisos_equipe[0], usuario).toMatchObject({ status: "sem_destino", resposta: "vendedor sem WhatsApp" });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("manda o WhatsApp atual do vendedor", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    reivindicados = [aviso({ corpo: { evento: "vendedor_resumo_diario", vendedor: { nome: "Hugo Prado", primeiro_nome: "Hugo", telefone: "5511000000000", whatsapp: "+5511000000000" }, mensagem: "Oi", dados: {} }, evento: "vendedor_resumo_diario", sessao_id: null })];
    await entregarAvisosEquipe(AGORA);
    const corpo = JSON.parse(String((f.mock.calls as unknown as [string, RequestInit][])[0][1].body));
    expect(corpo.vendedor).toEqual({ nome: "Hugo Prado", primeiro_nome: "Hugo", telefone: "551138887777", whatsapp: "+551138887777" });
  });

  it("em breve: refaz os minutos no envio; depois do início vira obsoleto", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const corpo = {
      evento: "vendedor_sessao_em_breve", vendedor: { primeiro_nome: "Hugo" }, mensagem: "Hugo, sua call das 09:10 começa em 10 min, 2 inscritos.\nX",
      dados: { sessao: { inicio: "2026-10-23T12:10:00.000Z" }, hora: "09:10", inscritos: 2, minutos: 10 },
    };
    reivindicados = [aviso({ corpo })];
    await entregarAvisosEquipe(new Date("2026-10-23T12:06:00Z"));
    const enviado = JSON.parse(String((f.mock.calls as unknown as [string, RequestInit][])[0][1].body));
    expect(enviado.mensagem).toBe("Hugo, sua call das 09:10 começa em 4 min, 2 inscritos.\nX");
    falso.tabelas.avisos_equipe[0].status = "pendente";
    reivindicados = [aviso({ corpo })];
    await entregarAvisosEquipe(new Date("2026-10-23T12:10:00Z"));
    expect(falso.tabelas.avisos_equipe[0]).toMatchObject({ status: "sem_destino", resposta: "obsoleto" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("manda pro CRM com o segredo e marca enviado", async () => {
    reivindicados = [aviso()];
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect(await entregarAvisosEquipe(AGORA)).toEqual({ enviados: 1, falhas: 0 });
    const [url, init] = (f.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe(URL_EQUIPE);
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Webhook-Secret"]).toBe("s3gr3d0");
    expect(headers["X-Vortex-Call-Assinatura"]).toMatch(/^sha256=/);
    const corpo = JSON.parse(String(init.body));
    expect(corpo).toMatchObject({ evento: "vendedor_sessao_em_breve", mensagem: "Oi", enviado_em: AGORA.toISOString() });
    expect(falso.tabelas.avisos_equipe[0]).toMatchObject({ status: "enviado", resposta_status: 200 });
  });

  it("falha vira nova tentativa", async () => {
    reivindicados = [aviso()];
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro", { status: 500 })));
    expect(await entregarAvisosEquipe(AGORA)).toEqual({ enviados: 0, falhas: 1 });
    expect(falso.tabelas.avisos_equipe[0]).toMatchObject({ status: "pendente", tentativas: 1, proxima_em: "2026-10-23T12:01:00.000Z" });
  });

  it("sem URL ou com a sessão cancelada: sem_destino, sem POST", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    reivindicados = [aviso()];
    falso.tabelas.configuracao[0].crm_url_equipe = null;
    await entregarAvisosEquipe(AGORA);
    expect(falso.tabelas.avisos_equipe[0]).toMatchObject({ status: "sem_destino" });
    falso.tabelas.configuracao[0].crm_url_equipe = URL_EQUIPE;
    falso.tabelas.avisos_equipe[0].status = "pendente";
    falso.tabelas.sessoes[0].status = "cancelada";
    await entregarAvisosEquipe(AGORA);
    expect(falso.tabelas.avisos_equipe[0]).toMatchObject({ status: "sem_destino", resposta: "obsoleto" });
    expect(f).not.toHaveBeenCalled();
  });

  it("novo agendamento de quem já mudou de sessão fica obsoleto", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    falso.tabelas.inscricoes.push({ id: "i1", sessao_id: "s-outra", status: "agendado" });
    reivindicados = [aviso({ evento: "vendedor_novo_agendamento", inscricao_id: "i1" })];
    await entregarAvisosEquipe(AGORA);
    expect(falso.tabelas.avisos_equipe[0]).toMatchObject({ status: "sem_destino", resposta: "obsoleto" });
    expect(f).not.toHaveBeenCalled();
  });
});
