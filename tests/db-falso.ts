import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Banco falso em memória com a parte do supabase-js que as funções de domínio da API usam: `select` (com
 *  relações embutidas `tabela(colunas)` e `tabela(count)`), `insert`, `update`, `delete`, filtros
 *  `upsert` (com `onConflict`), filtros `eq/neq/in/gte/gt/lte/lt/is/not(…, "is", null)` (filtro `relacao.coluna` filtra a relação embutida, como no PostgREST sem
 *  `!inner`), `order`, `limit`, `maybeSingle`, `single`. Erro do banco simulado por
 *  `falhar("tabela", "select" | "insert" | "update" | "delete")`. Sem cascata: apagar uma linha não apaga as
 *  linhas que dependeriam dela por FK (quem testa cascata usa `tests/banco.ts`, PGlite de verdade). */
type Linha = Record<string, unknown>;
type Rel = { tabela: string; local: string; remoto: string; um?: boolean };
type Op = "select" | "insert" | "update" | "delete" | "upsert";

export const RELACOES: Record<string, Record<string, Rel>> = {
  agendas: {
    usuarios: { tabela: "usuarios", local: "responsavel_id", remoto: "id", um: true },
  },
  sessoes: {
    agendas: { tabela: "agendas", local: "agenda_id", remoto: "id", um: true },
    usuarios: { tabela: "usuarios", local: "anfitriao_id", remoto: "id", um: true },
    inscricoes: { tabela: "inscricoes", local: "id", remoto: "sessao_id" },
  },
  inscricoes: {
    presencas: { tabela: "presencas", local: "id", remoto: "inscricao_id" },
    eventos: { tabela: "eventos", local: "id", remoto: "inscricao_id" },
    sessoes: { tabela: "sessoes", local: "sessao_id", remoto: "id", um: true },
    agendas: { tabela: "agendas", local: "agenda_id", remoto: "id", um: true },
  },
  gravacoes: {
    sessoes: { tabela: "sessoes", local: "sessao_id", remoto: "id", um: true },
    reunioes: { tabela: "reunioes", local: "reuniao_id", remoto: "id", um: true },
  },
};

const PADROES: Record<string, Linha> = {
  sessoes: { status: "agendada", titulo: null, repeticao_id: null },
  inscricoes: { status: "agendado", minutos_na_sala: 0, email: null },
  agendas: { ativa: true },
};

type Filtro = { coluna: string; teste: (v: unknown) => boolean };

function dividir(cols: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const c of cols) {
    if (c === "(") nivel++;
    if (c === ")") nivel--;
    if (c === "," && nivel === 0) {
      partes.push(atual.trim());
      atual = "";
    } else atual += c;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

const cmp = (a: unknown, b: unknown) => (a == null ? -1 : b == null ? 1 : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

export function criarDbFalso(tabelas: Record<string, Linha[]>) {
  const falhas = new Set<string>();
  const chamadas: { tabela: string; op: Op; valores?: unknown }[] = [];

  function projetar(tabela: string, linha: Linha, cols: string, filtros: Filtro[], prefixo: string): Linha {
    const out: Linha = {};
    for (const parte of dividir(cols)) {
      // `apelido:tabela!fk(colunas)` (apelido e dica de FK opcionais, como no PostgREST).
      const m = /^(?:(\w+):)?(\w+)(?:!\w+)?\((.*)\)$/s.exec(parte);
      if (!m) {
        if (parte === "*") Object.assign(out, linha);
        else out[parte] = linha[parte] ?? null;
        continue;
      }
      const [, apelido, nome, sub] = m;
      const chave = apelido ?? nome;
      const rel = RELACOES[tabela]?.[nome];
      if (!rel) throw new Error(`db falso: relação ${tabela}.${nome} não configurada`);
      const caminho = prefixo ? `${prefixo}.${nome}` : nome;
      const proprios = filtros.filter((f) => f.coluna.startsWith(`${caminho}.`) && !f.coluna.slice(caminho.length + 1).includes("."));
      const filhos = (tabelas[rel.tabela] ?? []).filter(
        (f) => f[rel.remoto] === linha[rel.local] && proprios.every((p) => p.teste(f[p.coluna.slice(caminho.length + 1)])),
      );
      if (sub.trim() === "count") out[chave] = [{ count: filhos.length }];
      else if (rel.um) out[chave] = filhos[0] ? projetar(rel.tabela, filhos[0], sub, filtros, caminho) : null;
      else out[chave] = filhos.map((f) => projetar(rel.tabela, f, sub, filtros, caminho));
    }
    return out;
  }

  function consulta(tabela: string) {
    let op: Op = "select";
    let cols: string | null = null;
    let valores: Linha | Linha[] | null = null;
    const filtros: Filtro[] = [];
    const ordem: { coluna: string; asc: boolean }[] = [];
    let limite: number | null = null;
    let conflito: string[] = [];

    const filtrar = (coluna: string, teste: (v: unknown) => boolean) => {
      filtros.push({ coluna, teste });
      return q;
    };

    function executar(): { data: unknown; error: { message: string; code?: string } | null } {
      chamadas.push({ tabela, op, valores: valores ?? undefined });
      if (falhas.has(`${tabela}:${op}`)) return { data: null, error: { message: "falha simulada" } };
      const linhas = (tabelas[tabela] ??= []);
      const raiz = filtros.filter((f) => !f.coluna.includes("."));
      let afetadas: Linha[];
      if (op === "upsert") {
        afetadas = [];
        for (const v of Array.isArray(valores) ? valores : [valores!]) {
          const igual = conflito.length ? linhas.find((l) => conflito.every((c) => l[c] === v[c])) : undefined;
          if (igual) Object.assign(igual, v);
          else linhas.push({ id: randomUUID(), created_at: new Date().toISOString(), ...PADROES[tabela], ...v });
          afetadas.push(igual ?? linhas[linhas.length - 1]);
        }
      } else if (op === "insert") {
        afetadas = (Array.isArray(valores) ? valores : [valores!]).map((v) => ({
          id: randomUUID(),
          created_at: new Date().toISOString(),
          ...PADROES[tabela],
          ...v,
        }));
        linhas.push(...afetadas);
      } else {
        afetadas = linhas.filter((l) => raiz.every((f) => f.teste(l[f.coluna])));
        if (op === "update") for (const l of afetadas) Object.assign(l, valores);
        if (op === "delete") tabelas[tabela] = linhas.filter((l) => !afetadas.includes(l));
      }
      if (op !== "select" && cols === null) return { data: null, error: null };
      let res = [...afetadas];
      for (const o of [...ordem].reverse()) res.sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.coluna], b[o.coluna]));
      if (limite !== null) res = res.slice(0, limite);
      return { data: res.map((l) => projetar(tabela, l, cols ?? "*", filtros, "")), error: null };
    }

    const q = {
      select: (c = "*") => {
        cols = c;
        return q;
      },
      insert: (v: Linha | Linha[]) => {
        op = "insert";
        valores = v;
        return q;
      },
      update: (v: Linha) => {
        op = "update";
        valores = v;
        return q;
      },
      upsert: (v: Linha | Linha[], o?: { onConflict?: string }) => {
        op = "upsert";
        valores = v;
        conflito = (o?.onConflict ?? "").split(",").map((c) => c.trim()).filter(Boolean);
        return q;
      },
      delete: (_opts?: { count?: "exact" }) => {
        op = "delete";
        return q;
      },
      eq: (c: string, v: unknown) => filtrar(c, (x) => x === v),
      neq: (c: string, v: unknown) => filtrar(c, (x) => x !== v),
      in: (c: string, vs: unknown[]) => filtrar(c, (x) => vs.includes(x)),
      gte: (c: string, v: string) => filtrar(c, (x) => x != null && String(x) >= v),
      gt: (c: string, v: string) => filtrar(c, (x) => x != null && String(x) > v),
      lte: (c: string, v: string) => filtrar(c, (x) => x != null && String(x) <= v),
      lt: (c: string, v: string) => filtrar(c, (x) => x != null && String(x) < v),
      is: (c: string, v: null) => filtrar(c, (x) => (x ?? null) === v),
      not: (c: string, operador: "is", v: null) => {
        if (operador !== "is") throw new Error(`db falso: not(${operador}) não suportado`);
        return filtrar(c, (x) => (x ?? null) !== v);
      },
      order: (c: string, o?: { ascending?: boolean }) => {
        ordem.push({ coluna: c, asc: o?.ascending !== false });
        return q;
      },
      limit: (n: number) => {
        limite = n;
        return q;
      },
      maybeSingle: () => {
        const r = executar();
        const lista = (r.data as Linha[] | null) ?? [];
        return Promise.resolve(r.error ? r : { data: lista[0] ?? null, error: null });
      },
      single: () => {
        const r = executar();
        const lista = (r.data as Linha[] | null) ?? [];
        if (r.error) return Promise.resolve(r);
        return Promise.resolve(lista.length === 1 ? { data: lista[0], error: null } : { data: null, error: { message: "não é uma linha", code: "PGRST116" } });
      },
      then: <T>(ok: (v: ReturnType<typeof executar>) => T, falha?: (e: unknown) => T) => Promise.resolve(executar()).then(ok, falha),
    };
    return q;
  }

  const db = { from: (t: string) => consulta(t) } as unknown as SupabaseClient;
  return {
    db,
    tabelas,
    chamadas,
    falhar: (tabela: string, op: Op) => falhas.add(`${tabela}:${op}`),
  };
}
