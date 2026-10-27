import { describe, expect, it } from "vitest";
import {
  avaliarEntrada,
  CARENCIA_MS,
  CARENCIA_PRESENTES_MS,
  estadoSino,
  marcarQueEntrei,
  nomeDeQuemEntrou,
  novoVigia,
  preferenciaLigada,
  primeiroNome,
  REPETIDA_MS,
  tipoCliente,
  tituloComAvisos,
  type Entrada,
} from "@/app/_sala/entradas-regras";
import { controlesDaBarra } from "@/app/_sala/barra-regras";

const LEAD = "0b8f7f8e-3c1a-4d2e-9f00-1234567890ab";
const lead = (id = "p1", nome = "Ana Paula Souza"): Entrada => ({ id, customId: LEAD, nome });
const T0 = 1_000_000;

function vigiaPronto(jaNaSala: Entrada[] = []) {
  const v = novoVigia();
  marcarQueEntrei(v, T0, jaNaSala);
  return v;
}

describe("tipoCliente", () => {
  it("lead (uuid da inscrição), convidado do link e visitante da reunião avisam", () => {
    expect(tipoCliente(LEAD)).toBe("lead");
    expect(tipoCliente(LEAD.toUpperCase())).toBe("lead");
    expect(tipoCliente("convidado:abc")).toBe("convidado");
    expect(tipoCliente("visitante:abc")).toBe("visitante");
  });

  it("equipe, gravador e sem id não avisam", () => {
    expect(tipoCliente("membro:123")).toBeNull();
    expect(tipoCliente("gravador")).toBeNull();
    expect(tipoCliente(null)).toBeNull();
    expect(tipoCliente("")).toBeNull();
  });
});

describe("nomes e título", () => {
  it("nome vazio vira Alguém; espaços extras somem", () => {
    expect(nomeDeQuemEntrou("  ")).toBe("Alguém");
    expect(nomeDeQuemEntrou(null)).toBe("Alguém");
    expect(nomeDeQuemEntrou("  Ana   Paula ")).toBe("Ana Paula");
  });

  it("primeiro nome", () => {
    expect(primeiroNome("Ana Paula Souza")).toBe("Ana");
    expect(primeiroNome("")).toBe("Alguém");
  });

  it("título da aba escondida", () => {
    expect(tituloComAvisos(2, "Ana")).toBe("(2) Ana entrou · Vórtex Call");
  });
});

describe("avaliarEntrada", () => {
  const depois = T0 + CARENCIA_PRESENTES_MS + 1;

  it("antes de eu entrar, nada avisa", () => {
    expect(avaliarEntrada(novoVigia(), lead(), { agora: depois, euId: "eu" })).toBeNull();
  });

  it("lead que entra depois de mim avisa com nome e primeiro nome", () => {
    expect(avaliarEntrada(vigiaPronto(), lead(), { agora: depois, euId: "eu" })).toEqual({
      chave: LEAD,
      nome: "Ana Paula Souza",
      primeiroNome: "Ana",
      tipo: "lead",
    });
  });

  it("eu mesmo e a equipe não avisam", () => {
    const v = vigiaPronto();
    expect(avaliarEntrada(v, lead("eu"), { agora: depois, euId: "eu" })).toBeNull();
    expect(avaliarEntrada(v, { id: "p2", customId: "membro:1", nome: "Mário" }, { agora: depois, euId: "eu" })).toBeNull();
  });

  it("na carência logo depois de entrar, ninguém avisa (o kit repete quem já estava)", () => {
    const v = vigiaPronto();
    expect(avaliarEntrada(v, lead(), { agora: T0 + CARENCIA_MS - 1, euId: "eu" })).toBeNull();
    expect(avaliarEntrada(v, lead(), { agora: T0 + CARENCIA_MS, euId: "eu" })).not.toBeNull();
  });

  it("quem já estava na sala não avisa no começo, mas avisa se voltar bem depois", () => {
    const v = vigiaPronto([lead("p0")]);
    expect(avaliarEntrada(v, lead("p9"), { agora: T0 + CARENCIA_MS + 10, euId: "eu" })).toBeNull();
    expect(avaliarEntrada(v, lead("p9"), { agora: depois, euId: "eu" })).not.toBeNull();
  });

  it("a mesma pessoa reconectando não avisa duas vezes no intervalo", () => {
    const v = vigiaPronto();
    expect(avaliarEntrada(v, lead("p1"), { agora: depois, euId: "eu" })).not.toBeNull();
    expect(avaliarEntrada(v, lead("p2"), { agora: depois + 5_000, euId: "eu" })).toBeNull();
    expect(avaliarEntrada(v, lead("p3"), { agora: depois + REPETIDA_MS, euId: "eu" })).not.toBeNull();
  });

  it("convidado sem nome avisa como Alguém", () => {
    const aviso = avaliarEntrada(vigiaPronto(), { id: "p5", customId: "convidado:ff", nome: "" }, { agora: depois, euId: "eu" });
    expect(aviso).toMatchObject({ nome: "Alguém", primeiroNome: "Alguém", tipo: "convidado" });
  });
});

describe("sino", () => {
  it("padrão ligado; só '0' desliga", () => {
    expect(preferenciaLigada(null)).toBe(true);
    expect(preferenciaLigada("1")).toBe(true);
    expect(preferenciaLigada("0")).toBe(false);
  });

  it("estados do botão", () => {
    expect(estadoSino(false, "granted")).toMatchObject({ acao: "ligar", ativo: false, rotulo: "Avisar quando alguém entrar" });
    expect(estadoSino(true, "default").acao).toBe("pedir");
    expect(estadoSino(true, "denied")).toMatchObject({ acao: "desligar", rotulo: "Notificações bloqueadas no navegador" });
    expect(estadoSino(true, "granted")).toMatchObject({ acao: "desligar", ativo: true });
    expect(estadoSino(true, "sem_suporte").acao).toBe("desligar");
  });

  it("barra: sino antes do 'mais' pro anfitrião, antes do sair pro espião, nunca pro lead", () => {
    const o = { gravacao: true, telaNoAparelho: true, avisos: true };
    expect(controlesDaBarra("anfitriao", o).centro).toEqual(["microfone", "camera", "tela", "gravar", "fundo", "avisos", "mais", "sair"]);
    expect(controlesDaBarra("espiao", o).centro).toEqual(["avisos", "sair"]);
    expect(controlesDaBarra("convidado", o).centro).not.toContain("avisos");
    expect(controlesDaBarra("participante", o).centro).not.toContain("avisos");
    expect(controlesDaBarra("anfitriao", { gravacao: true, telaNoAparelho: true }).centro).not.toContain("avisos");
  });
});
