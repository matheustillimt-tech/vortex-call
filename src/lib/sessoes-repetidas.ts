import "server-only";
import { datasDaRepeticao, type Repeticao } from "./regras/repeticao";
import { dbAdmin } from "./supabase/admin";

const SEMANAS = 4;

type RepeticaoBanco = Repeticao & { id: string; agenda_id: string };

export function sessoesQueFaltam(r: RepeticaoBanco, existentes: string[], agora: Date) {
  const ja = new Set(existentes.map((e) => new Date(e).getTime()));
  return datasDaRepeticao(r, agora, SEMANAS)
    .filter((d) => !ja.has(d.getTime()))
    .map((d) => ({ agenda_id: r.agenda_id, repeticao_id: r.id, inicio: d.toISOString(), vagas: r.vagas }));
}

/** Para cada repetição ativa, cria as sessões das próximas 4 semanas que ainda não existem. */
export async function gerarSessoesRepetidas(agora = new Date()): Promise<number> {
  const db = dbAdmin();
  const { data: reps, error } = await db.from("repeticoes").select("id, agenda_id, dias_semana, hora, vagas, ate").eq("ativa", true);
  if (error) throw new Error(`repeticoes: ${error.message}`);
  let criadas = 0;
  for (const r of (reps ?? []) as RepeticaoBanco[]) {
    const { data: ex } = await db.from("sessoes").select("inicio").eq("repeticao_id", r.id).gte("inicio", agora.toISOString());
    const novas = sessoesQueFaltam(r, (ex ?? []).map((e) => e.inicio as string), agora);
    if (!novas.length) continue;
    const { data: gravadas, error: e2 } = await db
      .from("sessoes")
      .upsert(novas, { onConflict: "repeticao_id,inicio", ignoreDuplicates: true })
      .select("id");
    if (e2) throw new Error(`sessoes: ${e2.message}`);
    criadas += gravadas?.length ?? 0;
  }
  return criadas;
}
