import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** Telefone digitado → E.164 (`+551137654321`), ou null se não for um número válido. */
export function paraE164(telefone: string, pais: CountryCode = "BR"): string | null {
  const t = telefone.trim();
  if (!t) return null;
  const n = parsePhoneNumberFromString(t, pais);
  return n && n.isValid() ? n.number : null;
}
