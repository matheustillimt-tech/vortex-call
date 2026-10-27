import { describe, expect, it } from "vitest";
import { linkGoogleAgenda } from "@/src/lib/regras/google-agenda";

describe("linkGoogleAgenda", () => {
  it("monta o link de evento com datas em UTC", () => {
    const u = new URL(
      linkGoogleAgenda({
        titulo: "Call Vórtex",
        inicio: new Date("2026-10-27T12:00:00Z"),
        fim: new Date("2026-10-27T13:00:00Z"),
        detalhes: "Entre por https://call.exemplo.com.br/c/abcdefghjk",
      }),
    );
    expect(u.origin + u.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(u.searchParams.get("action")).toBe("TEMPLATE");
    expect(u.searchParams.get("text")).toBe("Call Vórtex");
    expect(u.searchParams.get("dates")).toBe("20261027T120000Z/20261027T130000Z");
    expect(u.searchParams.get("details")).toContain("/c/abcdefghjk");
  });
});
