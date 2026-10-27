import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let sessao: { id: string; agenda_id: string } | null;
let inscricao: Record<string, unknown> | null;
const rpc = vi.fn();
vi.mock("@/src/lib/supabase/admin", () => ({
  dbAdmin: () => ({
    from: (t: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: t === "inscricoes" ? inscricao : sessao }) }) }) }),
    rpc: (...a: unknown[]) => rpc(...a),
  }),
}));
const enfileirar = vi.fn(async () => true);
vi.mock("@/src/lib/eventos", () => ({ enfileirar: (...a: unknown[]) => enfileirar(...(a as [])) }));
const avisar = vi.fn(async () => undefined);
vi.mock("@/src/lib/avisos-equipe", () => ({ avisarNovoAgendamento: (...a: unknown[]) => avisar(...(a as [])) }));
vi.mock("@/src/lib/env", () => ({ siteUrl: () => "https://call.exemplo.com" }));

const SESSAO = "11111111-1111-4111-8111-111111111111";
const ENTRADA = { sessao: SESSAO, nome: "Maria Souza", whatsapp: "(11) 3765-4321", email: "maria@exemplo.com" };
const linha = (resultado: string, codigo: string | null = "abcdefghjk") => ({ data: [{ resultado, inscricao_id: codigo ? "insc1" : null, codigo }], error: null });

beforeEach(() => {
  sessao = { id: SESSAO, agenda_id: "ag1" };
  inscricao = { agenda_id: "ag1", sessao_id: "velha", nome: "Maria Souza", whatsapp: "+551137654321", email: null, status: "agendado" };
  rpc.mockReset();
  enfileirar.mockClear();
  avisar.mockClear();
});

describe("agendarNoPainel", () => {
  it("inscreve com origem painel, avisa o lead e o vendedor e devolve o link da sala", async () => {
    rpc.mockResolvedValue(linha("nova"));
    const { agendarNoPainel } = await import("@/src/lib/agendar-manual");
    expect(await agendarNoPainel("ag1", ENTRADA)).toEqual({ ok: true, link: "https://call.exemplo.com/c/abcdefghjk", resultado: "nova" });
    expect(rpc).toHaveBeenCalledWith("inscrever", expect.objectContaining({ p_sessao: SESSAO, p_nome: "Maria Souza", p_whatsapp: "+551137654321", p_email: "maria@exemplo.com", p_origem: "painel" }));
    expect(enfileirar).toHaveBeenCalledWith("agendou", "insc1");
    expect(avisar).toHaveBeenCalledWith("insc1", false);
  });

  it("pessoa já na sessão: devolve o link sem mandar aviso de novo", async () => {
    rpc.mockResolvedValue(linha("mesma"));
    const { agendarNoPainel } = await import("@/src/lib/agendar-manual");
    expect(await agendarNoPainel("ag1", ENTRADA)).toMatchObject({ ok: true, resultado: "mesma" });
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it("sessão lotada ou de outra agenda: erro e nenhum aviso", async () => {
    rpc.mockResolvedValue(linha("lotada", null));
    const { agendarNoPainel } = await import("@/src/lib/agendar-manual");
    expect(await agendarNoPainel("ag1", ENTRADA)).toEqual({ erro: expect.stringContaining("lotada") });
    sessao = { id: SESSAO, agenda_id: "outra" };
    expect(await agendarNoPainel("ag1", ENTRADA)).toEqual({ erro: "Esse horário não é desta agenda." });
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it("valida nome, telefone e e-mail antes de gravar", async () => {
    const { agendarNoPainel } = await import("@/src/lib/agendar-manual");
    expect(await agendarNoPainel("ag1", { ...ENTRADA, nome: " " })).toEqual({ erro: "Informe o nome." });
    expect(await agendarNoPainel("ag1", { ...ENTRADA, whatsapp: "123" })).toEqual({ erro: "Confira o telefone com DDD." });
    expect(await agendarNoPainel("ag1", { ...ENTRADA, email: "x@" })).toEqual({ erro: "Confira o e-mail." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("colisão de código tenta de novo uma vez", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "inscricoes_codigo_key" } }).mockResolvedValueOnce(linha("nova"));
    const { agendarNoPainel } = await import("@/src/lib/agendar-manual");
    expect(await agendarNoPainel("ag1", ENTRADA)).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("trocarHorario", () => {
  it("move o inscrito pra outra sessão com os dados dele e manda o agendou de novo", async () => {
    rpc.mockResolvedValue(linha("reagendada"));
    const { trocarHorario } = await import("@/src/lib/agendar-manual");
    expect(await trocarHorario("insc1", "velha", SESSAO)).toEqual({ ok: true, link: "https://call.exemplo.com/c/abcdefghjk", resultado: "reagendada" });
    expect(rpc).toHaveBeenCalledWith("inscrever", expect.objectContaining({ p_sessao: SESSAO, p_nome: "Maria Souza", p_whatsapp: "+551137654321", p_email: null, p_origem: "painel" }));
    expect(enfileirar).toHaveBeenCalledWith("agendou", "insc1");
    expect(avisar).toHaveBeenCalledWith("insc1", true);
  });

  it("recusa a mesma sessão, inscrição de outra sessão, quem não está agendado e inscrição que não existe", async () => {
    const { trocarHorario } = await import("@/src/lib/agendar-manual");
    expect(await trocarHorario("insc1", "velha", "velha")).toEqual({ erro: "Escolha um horário diferente do atual." });
    expect(await trocarHorario("insc1", "outra", SESSAO)).toEqual({ erro: expect.stringContaining("não está mais nesta sessão") });
    inscricao = { ...inscricao, status: "faltou" };
    expect(await trocarHorario("insc1", "velha", SESSAO)).toEqual({ erro: "Só dá para trocar o horário de quem está agendado." });
    inscricao = null;
    expect(await trocarHorario("insc1", "velha", SESSAO)).toEqual({ erro: "Inscrição não encontrada." });
    expect(rpc).not.toHaveBeenCalled();
  });
});
