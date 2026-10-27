import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { siteUrl } from "@/src/lib/env";

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL;
});

describe("siteUrl", () => {
  it("devolve a URL como está quando não tem barra no fim", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://call.exemplo.com.br";
    expect(siteUrl()).toBe("https://call.exemplo.com.br");
  });

  it("tira a(s) barra(s) do fim", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://call.exemplo.com.br/";
    expect(siteUrl()).toBe("https://call.exemplo.com.br");
    process.env.NEXT_PUBLIC_SITE_URL = "https://call.exemplo.com.br///";
    expect(siteUrl()).toBe("https://call.exemplo.com.br");
  });

  it("sem a variável, estoura", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(() => siteUrl()).toThrow("NEXT_PUBLIC_SITE_URL");
  });
});
