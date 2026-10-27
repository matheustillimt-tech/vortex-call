import { describe, expect, it } from "vitest";
import { lerAgenda, lerCrm } from "@/src/lib/regras/agenda-form";

function form(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

const ok = { nome: "Call de vendas", slug: "vendas", titulo_publico: "Escolha seu horário", descricao: "", duracao_min: "60", vagas_padrao: "30", abre_antes_min: "5", roteiro: "", grava_sozinha: "on", ativa: "on" };

describe("lerAgenda", () => {
  it("lê e converte os campos", () => {
    expect(lerAgenda(form(ok)).dados).toEqual({
      nome: "Call de vendas", slug: "vendas", titulo_publico: "Escolha seu horário", descricao: "", duracao_min: 60,
      vagas_padrao: 30, abre_antes_min: 5, roteiro: "", grava_sozinha: true, transcrever: false, ativa: true, responsavel_id: null, janela_dias: null,
    });
  });
  it("transcrever: caixa marcada liga", () => {
    expect(lerAgenda(form({ ...ok, transcrever: "on" })).dados?.transcrever).toBe(true);
  });
  it("responsável (vendedor): id de usuário ou vazio (sem responsável); lixo erra", () => {
    const UUID = "11111111-2222-4333-8444-555555555555";
    expect(lerAgenda(form({ ...ok, responsavel_id: UUID })).dados?.responsavel_id).toBe(UUID);
    expect(lerAgenda(form({ ...ok, responsavel_id: "" })).dados?.responsavel_id).toBeNull();
    expect(lerAgenda(form({ ...ok, responsavel_id: "hugo" })).erro).toBe("Escolha o responsável da lista.");
  });
  it("checkbox desmarcado vira false", () => {
    const { grava_sozinha, ativa, ...semCaixas } = ok;
    void grava_sozinha; void ativa;
    expect(lerAgenda(form(semCaixas)).dados).toMatchObject({ grava_sozinha: false, ativa: false });
  });
  it("gera o endereço a partir do nome quando vier vazio", () => {
    expect(lerAgenda(form({ ...ok, slug: "", nome: "Call de Vendas Março" })).dados?.slug).toBe("call-de-vendas-marco");
  });
  it("recusa números fora do limite", () => {
    expect(lerAgenda(form({ ...ok, vagas_padrao: "0" })).erro).toBe("Vagas: de 1 a 500.");
    expect(lerAgenda(form({ ...ok, duracao_min: "5" })).erro).toBe("Duração: de 15 a 480 minutos.");
    expect(lerAgenda(form({ ...ok, abre_antes_min: "90" })).erro).toBe("A sala abre de 0 a 60 minutos antes.");
  });
  it("janela de agendamento: vazio = sem limite; de 1 a 60 dias; fora disso erra", () => {
    expect(lerAgenda(form({ ...ok, janela_dias: "" })).dados?.janela_dias).toBeNull();
    expect(lerAgenda(form({ ...ok, janela_dias: " 2 " })).dados?.janela_dias).toBe(2);
    expect(lerAgenda(form({ ...ok, janela_dias: "60" })).dados?.janela_dias).toBe(60);
    const msg = "Mostrar os próximos dias: de 1 a 60 (ou vazio pra mostrar todos).";
    expect(lerAgenda(form({ ...ok, janela_dias: "0" })).erro).toBe(msg);
    expect(lerAgenda(form({ ...ok, janela_dias: "61" })).erro).toBe(msg);
    expect(lerAgenda(form({ ...ok, janela_dias: "1.5" })).erro).toBe(msg);
  });
  it("pede nome", () => {
    expect(lerAgenda(form({ ...ok, nome: " " })).erro).toBe("Informe o nome da agenda.");
  });
});

describe("lerCrm", () => {
  it("URL de disparo: vazia vira null; https vale; outra coisa erra", () => {
    const f = (v: string) => { const fd = new FormData(); fd.set("disparo_url", v); return lerCrm(fd); };
    expect(f("").disparo_url).toBeNull();
    expect(f("https://disparo.exemplo.com.br/v1/x").disparo_url).toBe("https://disparo.exemplo.com.br/v1/x");
    expect(f("http://x.test").erro).toBeTruthy();
  });
  it("lê as URLs válidas preenchidas", () => {
    const r = lerCrm(form({ crm_url_agendou: "https://crm.test/hook/agendou", crm_url_compareceu: "https://crm.test/hook/compareceu" }));
    expect(r.erro).toBeUndefined();
    expect(r.crm_urls).toEqual({ agendou: "https://crm.test/hook/agendou", compareceu: "https://crm.test/hook/compareceu" });
  });
  it("recusa URL que não é https://", () => {
    const r = lerCrm(form({ crm_url_agendou: "http://crm.test/hook" }));
    expect(r.erro).toBe("URL do CRM: use um endereço https:// de até 500 caracteres.");
  });
  it("recusa URL com mais de 500 caracteres", () => {
    const r = lerCrm(form({ crm_url_agendou: `https://crm.test/${"a".repeat(500)}` }));
    expect(r.erro).toBe("URL do CRM: use um endereço https:// de até 500 caracteres.");
  });
  it("campo de URL vazio não entra no mapa", () => {
    const r = lerCrm(form({ crm_url_agendou: "", crm_url_comecou: "   " }));
    expect(r.crm_urls).toEqual({});
  });
  it("segredo em branco mantém o atual (undefined)", () => {
    const r = lerCrm(form({ crm_segredo: "" }));
    expect(r.crm_segredo).toBeUndefined();
  });
  it("segredo digitado vira o novo valor", () => {
    const r = lerCrm(form({ crm_segredo: "s3gredo-novo" }));
    expect(r.crm_segredo).toBe("s3gredo-novo");
  });
  it("marcar 'remover segredo' limpa (null), mesmo com um valor digitado", () => {
    const r = lerCrm(form({ crm_segredo: "ainda-digitado", crm_remover_segredo: "on" }));
    expect(r.crm_segredo).toBeNull();
  });
  it("recusa segredo com mais de 200 caracteres", () => {
    const r = lerCrm(form({ crm_segredo: "a".repeat(201) }));
    expect(r.erro).toBe("Segredo: até 200 caracteres.");
  });
});
