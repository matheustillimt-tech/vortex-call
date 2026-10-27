import { describe, expect, it } from "vitest";
import { ehWellKnown, precisaRenovarSessao, rotaPublica } from "@/src/lib/regras/rota";

describe("rotaPublica", () => {
  it("abre o módulo, o link pessoal e a API pública", () => {
    for (const p of [
      "/login", "/agendar/vendas", "/agendar.js", "/c/abc123", "/api/agendamento/vendas", "/api/cron/tick",
      "/api/sala/estado/abc123defg", "/api/sala/convidado/abc123defg", "/api/sala/atividade/abc123defg", "/api/webhooks/realtimekit",
      "/api/webhooks/pay/algumtoken",
      "/r/abc123defg", "/api/reunioes/estado/abc123defg", "/api/reunioes/entrar/abc123defg",
      "/api/v1/gravacoes", "/api/v1/", "/api/mcp",
      "/s/AbCdEfGhIjKlMnOpQrStUv", "/api/convite/AbCdEfGhIjKlMnOpQrStUv",
    ]) {
      expect(rotaPublica(p)).toBe(true);
    }
  });
  it("fecha o painel", () => {
    for (const p of ["/", "/agendas", "/sessoes/1", "/equipe", "/agendar.jsx", "/api/outra"]) expect(rotaPublica(p)).toBe(false);
  });
  it("/api/mcp é exato: /api/mcpx ou /api/mcp/x não casam", () => {
    for (const p of ["/api/mcpx", "/api/mcp/x"]) expect(rotaPublica(p)).toBe(false);
  });
  it("fecha as rotas de sala da equipe (exigem login)", () => {
    for (const p of [
      "/api/sala/equipe/sess1", "/api/sala/encerrar/sess1", "/api/sala/link-convidado/sess1", "/s", "/sessoes",
      "/api/sala/ficha/sess1/insc1", "/api/sala/ficha/sess1/insc1/resumo", "/api/sala/ficha/sess1/insc1/observacoes",
    ]) {
      expect(rotaPublica(p)).toBe(false);
    }
  });
  it("reunião: criar, encerrar e a lista exigem login", () => {
    for (const p of ["/api/reunioes", "/api/reunioes/", "/api/reunioes/encerrar/abc123defg", "/reunioes", "/r"]) expect(rotaPublica(p)).toBe(false);
  });
  it("fecha a página de teste de encaixe (não é pra ficar pública em produção)", () => {
    expect(rotaPublica("/teste-encaixe.html")).toBe(false);
  });
});

describe("ehWellKnown", () => {
  it("casa qualquer caminho sob /.well-known/", () => {
    for (const p of ["/.well-known/oauth-authorization-server", "/.well-known/mcp/x"]) expect(ehWellKnown(p)).toBe(true);
  });
  it("não casa o resto", () => {
    for (const p of ["/", "/api/mcp", "/well-known", "/.well-known"]) expect(ehWellKnown(p)).toBe(false);
  });
});

describe("precisaRenovarSessao", () => {
  it("renova na reunião /r/ (pública, mas o membro logado entra como anfitrião) e em toda rota fechada", () => {
    for (const p of ["/r/abc123defg", "/", "/reunioes", "/sessoes/1", "/api/reunioes", "/api/reunioes/encerrar/abc123defg"]) {
      expect(precisaRenovarSessao(p)).toBe(true);
    }
  });
  it("as outras públicas não tocam no Supabase", () => {
    for (const p of ["/login", "/c/abc123defg", "/agendar/vendas", "/api/cron/tick", "/api/webhooks/realtimekit", "/api/webhooks/pay/algumtoken", "/api/reunioes/estado/abc123defg", "/api/reunioes/entrar/abc123defg"]) {
      expect(precisaRenovarSessao(p)).toBe(false);
    }
  });
  it("a API pública e o MCP não tocam no Supabase (a rota confere a chave)", () => {
    for (const p of ["/api/v1/gravacoes", "/api/mcp"]) expect(precisaRenovarSessao(p)).toBe(false);
  });
});
