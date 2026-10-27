import type { SupabaseClient } from "@supabase/supabase-js";
import { ErroApi } from "./http";

export type InscritoApi = {
  id: string;
  nome: string;
  whatsapp: string;
  email: string | null;
  status: string;
  minutos_na_sala: number;
  presencas: { entrou_em: string; saiu_em: string | null }[];
  avisos: { evento: string; status: string }[];
};

type Linha = Omit<InscritoApi, "presencas" | "avisos"> & {
  presencas: { entrou_em: string; saiu_em: string | null }[] | null;
  eventos: { evento: string; status: string; created_at: string }[] | null;
};

const porTexto = <T>(campo: keyof T) => (a: T, b: T) => String(a[campo]).localeCompare(String(b[campo]));

/** Inscritos de uma sessão (todos os status), por ordem de inscrição, com as entradas/saídas da sala e os avisos
 *  (webhooks do CRM) em ordem. Dados pessoais: só por chave válida, nunca em log. Sessão inexistente → 404. */
export async function listarInscritos(db: SupabaseClient, sessaoId: string): Promise<InscritoApi[]> {
  const { data: sessao, error: erroSessao } = await db.from("sessoes").select("id").eq("id", sessaoId).maybeSingle();
  if (erroSessao) throw new Error("Não deu para ler a sessão.");
  if (!sessao) throw new ErroApi(404, "Sessão não encontrada.");
  const { data, error } = await db
    .from("inscricoes")
    .select("id, nome, whatsapp, email, status, minutos_na_sala, created_at, presencas(entrou_em, saiu_em), eventos(evento, status, created_at)")
    .eq("sessao_id", sessaoId)
    .order("created_at");
  if (error) throw new Error("Não deu para listar os inscritos.");
  return ((data ?? []) as unknown as Linha[]).map((i) => ({
    id: i.id,
    nome: i.nome,
    whatsapp: i.whatsapp,
    email: i.email,
    status: i.status,
    minutos_na_sala: i.minutos_na_sala,
    presencas: [...(i.presencas ?? [])].sort(porTexto("entrou_em")).map((p) => ({ entrou_em: p.entrou_em, saiu_em: p.saiu_em })),
    avisos: [...(i.eventos ?? [])].sort(porTexto("created_at")).map((e) => ({ evento: e.evento, status: e.status })),
  }));
}
