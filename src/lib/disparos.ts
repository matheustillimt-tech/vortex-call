import "server-only";
import { enfileirar } from "./eventos";
import { duracaoDaAgenda, MARGEM_FECHAR_MIN } from "./regras/estado-sala";
import { deveLembrar, idEvento, minutosDePresenca, presencasAteOFim, type NomeEvento } from "./regras/eventos";
import { ESPERA_TRANSCRICAO_MIN, marcarResumoPendente } from "./resumo-final";
import { dbAdmin } from "./supabase/admin";
import { avisarCompra } from "./vendas";

/** Quem decide QUANDO cada evento do CRM nasce (agendou fica na rota de inscrição): começou (na hora marcada), lembretes e a
 *  avaliação de presença (compareceu/faltou). Separado de `eventos.ts` (fila e entrega) pra que os testes possam
 *  trocar o `enfileirar` por um mock. `enfileirar` lança em dado órfão: aqui cada chamada tem seu try/catch. */

const MIN = 60_000;
const HORA = 60 * MIN;
const DURACAO_MINIMA_MIN = 15;
const PAGINA = 1000;

/** Lê todas as linhas de uma consulta em páginas de 1000 (o PostgREST corta em 1000 por padrão). `montar` cria a
 *  consulta de novo a cada página (o builder do supabase-js não é reutilizável). */
async function lerTudo<T>(
  montar: () => { range: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
): Promise<{ data: T[]; error: { message: string } | null }> {
  const todas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await montar().range(de, de + PAGINA - 1);
    if (error) return { data: todas, error };
    const pagina = (data ?? []) as T[];
    todas.push(...pagina);
    if (pagina.length < PAGINA) return { data: todas, error: null };
  }
}

async function tentarEnfileirar(evento: NomeEvento, inscricaoId: string, agora: Date): Promise<boolean> {
  try {
    return await enfileirar(evento, inscricaoId, agora);
  } catch (e) {
    console.error("[crm] não enfileirou", evento, e instanceof Error ? e.message : "erro");
    return false;
  }
}

/** Atraso máximo pro "começou": se o cron ficar parado, quem agendou não recebe "tá começando" 10 min depois. */
const JANELA_COMECOU_MIN = 10;

/** Avisa quem está `agendado` na sessão, ainda não entrou na sala e ainda não tem o "começou" na fila. */
export async function enfileirarComecou(sessaoId: string, agora: Date = new Date()): Promise<number> {
  const db = dbAdmin();
  const { data: inscricoes, error } = await db.from("inscricoes").select("id").eq("sessao_id", sessaoId).eq("status", "agendado");
  if (error) throw new Error("Não foi possível listar as inscrições.");
  const { data: presencas, error: erroPresencas } = await db.from("presencas").select("inscricao_id").eq("sessao_id", sessaoId);
  if (erroPresencas) throw new Error("Não foi possível listar as presenças.");
  const presentes = new Set(((presencas ?? []) as { inscricao_id: string }[]).map((p) => p.inscricao_id));
  const { data: naFila, error: erroFila } = await db.from("eventos").select("inscricao_id").eq("sessao_id", sessaoId).eq("evento", "comecou");
  if (erroFila) console.warn("[crm] não leu a fila do comecou", erroFila.message);
  const jaNaFila = new Set(((naFila ?? []) as { inscricao_id: string }[]).map((e) => e.inscricao_id));

  let n = 0;
  for (const i of (inscricoes ?? []) as { id: string }[]) {
    if (presentes.has(i.id) || jaNaFila.has(i.id)) continue;
    if (await tentarEnfileirar("comecou", i.id, agora)) n++;
  }
  return n;
}

/** Cron: "começou" no horário marcado da sessão (não quando o anfitrião abre a sala). Pega as sessões agendadas ou
 *  ao vivo cujo início já chegou há no máximo 10 min; quem ainda não entrou recebe o aviso uma vez só (fila +
 *  `id_evento` único). Anfitrião atrasado não atrapalha: o link leva o lead pra espera, que apita quando a sala abre. */
export async function enfileirarComecouNaHora(agora: Date = new Date()): Promise<number> {
  const db = dbAdmin();
  const { data: sessoes, error } = await db
    .from("sessoes")
    .select("id")
    .in("status", ["agendada", "ao_vivo"])
    .lte("inicio", agora.toISOString())
    .gt("inicio", new Date(agora.getTime() - JANELA_COMECOU_MIN * MIN).toISOString());
  if (error) throw new Error("Não foi possível listar as sessões.");
  let n = 0;
  for (const s of (sessoes ?? []) as { id: string }[]) {
    try {
      n += await enfileirarComecou(s.id, agora);
    } catch (e) {
      console.error("[crm] falha no comecou da sessão", s.id, e instanceof Error ? e.message : "erro");
    }
  }
  return n;
}

/** Cron: lembretes de 24 h e 1 h das sessões que começam nas próximas 24 h. Uma consulta pras sessões, uma pras
 *  inscrições e uma pros lembretes já na fila (pra não refazer o `enfileirar` de todo mundo a cada minuto; o
 *  `id_evento` único continua sendo a garantia de verdade), as duas últimas em páginas de 1000. A janela de cada
 *  lembrete olha `agendado_em` (muda ao reagendar), não `created_at`. Devolve quantos entraram na fila. */
export async function enfileirarLembretes(agora: Date = new Date()): Promise<number> {
  const db = dbAdmin();
  const { data: sessoes, error } = await db
    .from("sessoes")
    .select("id, inicio")
    .in("status", ["agendada", "ao_vivo"])
    .gt("inicio", agora.toISOString())
    .lte("inicio", new Date(agora.getTime() + 24 * HORA).toISOString());
  if (error) throw new Error("Não foi possível listar as sessões.");
  const lista = (sessoes ?? []) as { id: string; inicio: string }[];
  if (lista.length === 0) return 0;
  const ids = lista.map((s) => s.id);
  const inicioPorSessao = new Map(lista.map((s) => [s.id, new Date(s.inicio)]));

  type InscricaoLembrete = { id: string; sessao_id: string; agendado_em: string };
  const { data: inscricoes, error: erroInsc } = await lerTudo<InscricaoLembrete>(() =>
    db.from("inscricoes").select("id, sessao_id, agendado_em").in("sessao_id", ids).eq("status", "agendado").order("id"),
  );
  if (erroInsc) throw new Error("Não foi possível listar as inscrições.");

  const { data: naFila, error: erroFila } = await lerTudo<{ id_evento: string }>(() =>
    db.from("eventos").select("id_evento").in("sessao_id", ids).in("evento", ["lembrete_24h", "lembrete_1h"]).order("id"),
  );
  if (erroFila) console.warn("[crm] não leu a fila de lembretes", erroFila.message);
  const jaNaFila = new Set(naFila.map((e) => e.id_evento));

  let n = 0;
  for (const i of inscricoes) {
    const inicio = inicioPorSessao.get(i.sessao_id);
    if (!inicio) continue;
    for (const tipo of ["lembrete_24h", "lembrete_1h"] as const) {
      if (jaNaFila.has(idEvento(tipo, i.id, i.sessao_id))) continue;
      if (!deveLembrar({ tipo, inicio, inscritoEm: new Date(i.agendado_em), agora })) continue;
      if (await tentarEnfileirar(tipo, i.id, agora)) n++;
    }
  }
  return n;
}

type SessaoAvaliar = { id: string; inicio: string; status: string; aberta_em: string | null; agendas: unknown; rtk_transcreve?: boolean };

/** Avalia uma sessão: devolve true se terminou de processar todas as inscrições (aí pode marcar `avaliada_em`). */
async function avaliarUma(db: ReturnType<typeof dbAdmin>, s: SessaoAvaliar, fim: Date, agora: Date): Promise<boolean> {
  const { data: inscricoes, error } = await db.from("inscricoes").select("id").eq("sessao_id", s.id).eq("status", "agendado");
  if (error) throw new Error("Não foi possível listar as inscrições.");
  const { data: presencas, error: erroPresencas } = await db.from("presencas").select("inscricao_id, entrou_em, saiu_em").eq("sessao_id", s.id);
  if (erroPresencas) throw new Error("Não foi possível listar as presenças.");

  const porInscricao = new Map<string, { entrou: Date; saiu: Date | null }[]>();
  for (const p of (presencas ?? []) as { inscricao_id: string; entrou_em: string; saiu_em: string | null }[]) {
    const lista = porInscricao.get(p.inscricao_id) ?? [];
    lista.push({ entrou: new Date(p.entrou_em), saiu: p.saiu_em ? new Date(p.saiu_em) : null });
    porInscricao.set(p.inscricao_id, lista);
  }

  let tudoCerto = true;
  for (const i of (inscricoes ?? []) as { id: string }[]) {
    const intervalos = presencasAteOFim(porInscricao.get(i.id) ?? [], fim);
    const veio = intervalos.length > 0;
    const evento: NomeEvento = veio ? "compareceu" : "faltou";
    const minutos = veio ? minutosDePresenca(intervalos, fim) : undefined;
    const valores = veio ? { status: "compareceu", minutos_na_sala: minutos } : { status: "faltou" };
    // Enfileira ANTES de gravar: se a fila falhar, a inscrição continua `agendado` e a sessão sem `avaliada_em`, e
    // o próximo tick tenta de novo (gravar primeiro perderia o aviso de vez). `false` = já estava na fila (ok).
    // Os minutos vão direto pro corpo porque ainda não estão gravados na inscrição.
    try {
      await enfileirar(evento, i.id, agora, veio ? { minutosNaSala: minutos } : {});
    } catch (e) {
      console.error("[crm] não enfileirou", evento, e instanceof Error ? e.message : "erro");
      tudoCerto = false;
      continue;
    }
    // Só muda quem ainda está `agendado` nesta sessão (não sobrescreve um cancelamento/reagendamento feito no
    // meio-tempo).
    const { data: mudou, error: erroUpdate } = await db
      .from("inscricoes")
      .update(valores)
      .eq("id", i.id)
      .eq("sessao_id", s.id)
      .eq("status", "agendado")
      .select("id");
    if (erroUpdate) {
      console.error("[crm] não atualizou a presença da inscrição", s.id);
      tudoCerto = false;
      continue;
    }
    // Virou compareceu: liga as vendas da Pay que chegaram sem vínculo. Falha aqui só loga (a inscrição já saiu de
    // `agendado`, então repetir o tick não adiantaria; a venda continua registrada, só sem vínculo).
    if (veio && (mudou ?? []).length > 0) {
      const { error: erroReligar } = await db.rpc("religar_vendas", { p_inscricao: i.id });
      if (erroReligar) console.error("[crm] não religou as vendas da inscrição", i.id, erroReligar.message);
      // Comprou antes da presença ser avaliada: o aviso de compra sai agora (depois do "compareceu" na fila).
      else await avisarCompra(db, { inscricaoId: i.id });
    }
  }
  return tudoCerto;
}

/** Cron: avalia as sessões que acabaram e ainda não têm `avaliada_em`; cada inscrição `agendado` vira `compareceu`
 *  (+ minutos na sala) / `faltou`, com o evento na fila. Quando cada sessão conta como acabada:
 *  - `encerrada`: já; fim usado na conta = agora, limitado a início + duração + 2 h.
 *  - `ao_vivo`: só no prazo final (início + duração + 2 h), porque até lá ainda dá pra entrar na sala; fim = prazo.
 *  - `agendada` que o anfitrião nunca abriu (`aberta_em` nulo), passado início + duração: não houve call, então
 *    só marca `avaliada_em` (ninguém vira faltou e nenhum aviso sai).
 *  Uma sessão com erro não para as outras e fica sem `avaliada_em` (o próximo tick tenta de novo; o `id_evento`
 *  único evita evento repetido). Devolve quantas sessões foram marcadas como avaliadas. */
export async function avaliarSessoes(agora: Date = new Date()): Promise<number> {
  const db = dbAdmin();
  // Pré-filtro no banco (duração mínima de agenda é 15 min); a conta exata por duração é feita aqui.
  const limite = new Date(agora.getTime() - DURACAO_MINIMA_MIN * MIN).toISOString();
  const { data, error } = await db
    .from("sessoes")
    .select("id, inicio, status, aberta_em, rtk_transcreve, agendas(duracao_min)")
    .is("avaliada_em", null)
    .neq("status", "cancelada")
    .or(`status.eq.encerrada,inicio.lte.${limite}`);
  if (error) throw new Error("Não foi possível listar as sessões pra avaliar.");

  let avaliadas = 0;
  for (const s of (data ?? []) as SessaoAvaliar[]) {
    const inicio = new Date(s.inicio).getTime();
    const duracao = duracaoDaAgenda(s.agendas);
    if (duracao === null) {
      console.error("[crm] sessão sem agenda ou duração, não avaliada", s.id);
      continue;
    }
    const fimProgramado = inicio + duracao * MIN;
    const prazoFinal = fimProgramado + MARGEM_FECHAR_MIN * MIN;
    const nuncaAberta = s.status === "agendada" && !s.aberta_em;
    let fim: number;
    if (s.status === "encerrada") {
      fim = Math.min(agora.getTime(), prazoFinal);
    } else if (nuncaAberta) {
      if (agora.getTime() < fimProgramado) continue;
      fim = fimProgramado;
    } else {
      if (agora.getTime() < prazoFinal) continue;
      fim = prazoFinal;
    }
    try {
      if (nuncaAberta) {
        console.log("[crm] sessão nunca aberta, sem avaliação", s.id);
      } else if (!(await avaliarUma(db, s, new Date(fim), agora))) {
        continue;
      }
      const { error: erroSessao } = await db.from("sessoes").update({ avaliada_em: agora.toISOString() }).eq("id", s.id);
      if (erroSessao) throw new Error("Não foi possível marcar a sessão como avaliada.");
      avaliadas++;
      // Sessão transcrita: entra na fila do resumo final (espera a transcrição da Cloudflare; se ela já chegou, a fila
      // já está marcada e fica como está).
      if (s.rtk_transcreve === true && !nuncaAberta) {
        await marcarResumoPendente(s.id, new Date(agora.getTime() + ESPERA_TRANSCRICAO_MIN * 60_000), true).catch((e) =>
          console.error("[resumo] não pôs na fila", s.id, e instanceof Error ? e.message : "erro"),
        );
      }
    } catch (e) {
      console.error("[crm] falha ao avaliar sessão", s.id, e instanceof Error ? e.message : "erro");
    }
  }
  return avaliadas;
}
