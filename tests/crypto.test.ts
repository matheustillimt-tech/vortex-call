import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashIp } from "@/src/lib/crypto";

const ORIGINAL = process.env.CRYPTO_KEY;

beforeEach(() => {
  process.env.CRYPTO_KEY = "chave-de-teste-bem-longa-0123456789";
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRYPTO_KEY;
  else process.env.CRYPTO_KEY = ORIGINAL;
});

describe("hashIp", () => {
  it("gera um hash estável de 32 caracteres pro mesmo IP", () => {
    const a = hashIp("1.2.3.4");
    const b = hashIp("1.2.3.4");
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  it("IPs diferentes geram hashes diferentes", () => {
    expect(hashIp("1.2.3.4")).not.toBe(hashIp("5.6.7.8"));
  });

  it("sem CRYPTO_KEY configurada, estoura (não usa silenciosamente vazio)", () => {
    delete process.env.CRYPTO_KEY;
    expect(() => hashIp("1.2.3.4")).toThrow("CRYPTO_KEY");
  });
});
