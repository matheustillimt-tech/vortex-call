import { EVENTOS, type NomeEvento, urlValida } from "./eventos";
import { JANELA_MAX, JANELA_MIN } from "./janela";
import { gerarSlug, validarSlug } from "./slug";

export type DadosAgenda = {
  nome: string;
  slug: string;
  titulo_publico: string;
  descricao: string;
  duracao_min: number;
  vagas_padrao: number;
  abre_antes_min: number;
  roteiro: string;
  grava_sozinha: boolean;
  /** Transcreve a call (ao vivo e no fim) e manda o resumo do que foi alinhado pro CRM. */
  transcrever: boolean;
  ativa: boolean;
  /** Vendedor responsável (usuário da equipe); null = sem responsável (só admin vê os dados). */
  responsavel_id: string | null;
  /** Janela de agendamento: o lead só vê os próximos N dias com horário; null = todos. */
  janela_dias: number | null;
};

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function inteiro(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? "").trim());
  return Number.isInteger(n) ? n : NaN;
}

/** Lê e valida os campos do formulário de agenda. Sem endereço (`slug`), gera a partir do nome. */
export function lerAgenda(form: FormData): { dados?: DadosAgenda; erro?: string } {
  const texto = (k: string) => String(form.get(k) ?? "").trim();
  const nome = texto("nome");
  if (!nome) return { erro: "Informe o nome da agenda." };
  const slug = texto("slug") || gerarSlug(nome);
  const erroSlug = validarSlug(slug);
  if (erroSlug) return { erro: erroSlug };
  const duracao_min = inteiro(form.get("duracao_min"));
  if (!(duracao_min >= 15 && duracao_min <= 480)) return { erro: "Duração: de 15 a 480 minutos." };
  const vagas_padrao = inteiro(form.get("vagas_padrao"));
  if (!(vagas_padrao >= 1 && vagas_padrao <= 500)) return { erro: "Vagas: de 1 a 500." };
  const abre_antes_min = inteiro(form.get("abre_antes_min"));
  if (!(abre_antes_min >= 0 && abre_antes_min <= 60)) return { erro: "A sala abre de 0 a 60 minutos antes." };
  const janelaTexto = texto("janela_dias");
  const janela_dias = janelaTexto ? inteiro(janelaTexto) : null;
  if (janela_dias !== null && !(janela_dias >= JANELA_MIN && janela_dias <= JANELA_MAX)) {
    return { erro: `Mostrar os próximos dias: de ${JANELA_MIN} a ${JANELA_MAX} (ou vazio pra mostrar todos).` };
  }
  const responsavel = texto("responsavel_id");
  if (responsavel && !RE_UUID.test(responsavel)) return { erro: "Escolha o responsável da lista." };
  return {
    dados: {
      nome,
      slug,
      titulo_publico: texto("titulo_publico") || "Escolha o melhor horário pra sua call",
      descricao: texto("descricao"),
      duracao_min,
      vagas_padrao,
      abre_antes_min,
      roteiro: String(form.get("roteiro") ?? ""),
      grava_sozinha: form.get("grava_sozinha") === "on",
      transcrever: form.get("transcrever") === "on",
      ativa: form.get("ativa") === "on",
      responsavel_id: responsavel ? responsavel.toLowerCase() : null,
      janela_dias,
    },
  };
}

const SEGREDO_MAX = 200;

/** Lê os campos do cartão "CRM": uma URL por evento (campo `crm_url_{evento}`), o segredo opcional e a URL
 *  de disparo pela API oficial (`disparo_url`, vazia = `null`; recebe só os eventos que viram mensagem pro lead).
 *  URL vazia tira a chave do mapa (não manda mais pra esse evento); URL inválida (não `https://` ou mais de 500
 *  caracteres) erra. Segredo em branco ao editar mantém o atual (`crm_segredo` fica `undefined`); a caixa
 *  `crm_remover_segredo` marcada limpa o segredo (`crm_segredo: null`). */
export function lerCrm(form: FormData): { crm_urls: Record<NomeEvento, string>; crm_segredo?: string | null; disparo_url?: string | null; erro?: string } {
  const crm_urls: Partial<Record<NomeEvento, string>> = {};
  for (const evento of EVENTOS) {
    const valor = String(form.get(`crm_url_${evento}`) ?? "").trim();
    if (!valor) continue;
    if (!urlValida(valor)) return { crm_urls: {} as Record<NomeEvento, string>, erro: "URL do CRM: use um endereço https:// de até 500 caracteres." };
    crm_urls[evento] = valor;
  }

  const disparoDigitado = String(form.get("disparo_url") ?? "").trim();
  if (disparoDigitado && !urlValida(disparoDigitado)) return { crm_urls: {} as Record<NomeEvento, string>, erro: "URL de disparo: use um endereço https:// de até 500 caracteres." };
  const disparo_url = disparoDigitado || null;

  const removerSegredo = form.get("crm_remover_segredo") === "on";
  const segredoDigitado = String(form.get("crm_segredo") ?? "").trim();
  if (segredoDigitado.length > SEGREDO_MAX) return { crm_urls: {} as Record<NomeEvento, string>, erro: `Segredo: até ${SEGREDO_MAX} caracteres.` };

  let crm_segredo: string | null | undefined;
  if (removerSegredo) crm_segredo = null;
  else if (segredoDigitado) crm_segredo = segredoDigitado;

  return { crm_urls: crm_urls as Record<NomeEvento, string>, crm_segredo, disparo_url };
}
