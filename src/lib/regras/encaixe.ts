export type Prefill = { nome: string; whatsapp: string; email: string; resposta: string; utm: Record<string, string>; embed: boolean };

const UTMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

export function lerPrefill(sp: Record<string, string | string[] | undefined>): Prefill {
  const um = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] ?? "" : v ?? "").slice(0, 200);
  };
  const utm: Record<string, string> = {};
  for (const k of UTMS) if (um(k)) utm[k] = um(k);
  return { nome: um("nome"), whatsapp: um("whatsapp"), email: um("email"), resposta: um("r"), utm, embed: um("embed") === "1" };
}
