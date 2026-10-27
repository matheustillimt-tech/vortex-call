import { NextResponse } from "next/server";
import { avisarNovoAgendamento } from "@/src/lib/avisos-equipe";
import { hashIp } from "@/src/lib/crypto";
import { siteUrl } from "@/src/lib/env";
import { enfileirar } from "@/src/lib/eventos";
import { dentroDoLimite } from "@/src/lib/limite";
import { ehColisaoDeCodigo, gerarCodigo } from "@/src/lib/regras/codigo";
import { linkGoogleAgenda } from "@/src/lib/regras/google-agenda";
import { nomeEmpresa } from "@/src/lib/regras/marca";
import { validarInscricao } from "@/src/lib/regras/inscricao";
import { sessaoNaJanela, type SessaoJanela } from "@/src/lib/regras/janela";
import { CORS } from "@/src/lib/cors";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request, { params }: { params: Promise<{ agenda: string }> }) {
  const { agenda: slug } = await params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "sem-ip";
  if (!(await dentroDoLimite(`inscrever:${hashIp(ip)}`, 10))) {
    return NextResponse.json({ erro: "Muitas tentativas. Espere um minuto." }, { status: 429, headers: CORS });
  }
  const { dados, erro } = validarInscricao(await req.json().catch(() => null));
  if (!dados) return NextResponse.json({ erro }, { status: 400, headers: CORS });
  if (!(await dentroDoLimite(`inscrever-wa:${hashIp(dados.whatsapp)}`, 3))) {
    return NextResponse.json({ erro: "Muitas tentativas. Espere um minuto." }, { status: 429, headers: CORS });
  }

  const db = dbAdmin();
  const { data: agenda } = await db.from("agendas").select("id, titulo_publico, duracao_min, janela_dias").eq("slug", slug).eq("ativa", true).maybeSingle();
  if (!agenda) return NextResponse.json({ erro: "Agenda não encontrada." }, { status: 404, headers: CORS });
  const { data: sessao } = await db.from("sessoes").select("id, inicio, agenda_id").eq("id", dados.sessao).maybeSingle();
  if (!sessao || sessao.agenda_id !== agenda.id) return NextResponse.json({ erro: "Esse horário não é desta agenda.", resultado: "indisponivel" }, { status: 409, headers: CORS });

  // Janela de agendamento: com `janela_dias`, só vale sessão dos primeiros N dias com horário (mesma regra da
  // vitrine). Vale pra inscrição nova e pro reagendamento, que passam os dois por aqui.
  const janela = (agenda.janela_dias as number | null | undefined) ?? null;
  if (janela != null) {
    const { data: vitrine, error: erroVitrine } = await db.rpc("vitrine_agenda", { p_slug: slug });
    if (erroVitrine) return NextResponse.json({ erro: "Não deu para agendar. Tente de novo." }, { status: 500, headers: CORS });
    if (!sessaoNaJanela((vitrine ?? []) as SessaoJanela[], sessao.id, janela, new Date())) {
      return NextResponse.json({ erro: "Esse horário ainda não está aberto pra agendamento.", resultado: "fora_da_janela" }, { status: 409, headers: CORS });
    }
  }

  const chamarInscrever = (codigo: string) =>
    db.rpc("inscrever", {
      p_sessao: dados.sessao, p_codigo: codigo, p_nome: dados.nome, p_whatsapp: dados.whatsapp, p_email: dados.email,
      p_resposta: dados.resposta, p_respostas: dados.respostas, p_utm: dados.utm, p_origem: dados.origem,
    });

  let { data, error } = await chamarInscrever(gerarCodigo());
  if (error && ehColisaoDeCodigo(error)) {
    ({ data, error } = await chamarInscrever(gerarCodigo()));
  }
  if (error) return NextResponse.json({ erro: "Não deu para agendar. Tente de novo." }, { status: 500, headers: CORS });
  const r = (data as { resultado: string; inscricao_id: string | null; codigo: string | null }[] | null)?.[0];
  if (!r) return NextResponse.json({ erro: "Não deu para agendar. Tente de novo." }, { status: 500, headers: CORS });
  if (r.resultado === "lotada") return NextResponse.json({ erro: "Esse horário acabou de lotar. Escolha outro.", resultado: "lotada" }, { status: 409, headers: CORS });
  if (r.resultado === "indisponivel") return NextResponse.json({ erro: "Esse horário não está mais disponível.", resultado: "indisponivel" }, { status: 409, headers: CORS });

  // Aviso pro CRM (inscrição nova ou reagendada pra outra sessão). Falha aqui nunca derruba a inscrição; o log
  // não leva nome, WhatsApp nem código do lead.
  if ((r.resultado === "nova" || r.resultado === "reagendada") && r.inscricao_id) {
    try {
      await enfileirar("agendou", r.inscricao_id);
    } catch (e) {
      console.error("[crm] não enfileirou agendou", e instanceof Error ? e.message : "erro");
    }
    // Aviso pro vendedor responsável pela agenda (WhatsApp pelo CRM). Também nunca derruba a inscrição.
    try {
      await avisarNovoAgendamento(r.inscricao_id, r.resultado === "reagendada");
    } catch (e) {
      console.error("[equipe] não avisou o vendedor", e instanceof Error ? e.message : "erro");
    }
  }

  const inicio = new Date(sessao.inicio);
  const fim = new Date(inicio.getTime() + agenda.duracao_min * 60_000);
  // Só devolve código/link/Google Agenda numa inscrição nova: quem sabe o WhatsApp de um lead não pode usar
  // "mesma"/"reagendada" pra puxar o link pessoal dele nem (antes desta correção) renomeá-lo.
  if (r.resultado !== "nova") {
    return NextResponse.json({ resultado: r.resultado, inicio: inicio.toISOString(), fim: fim.toISOString() }, { headers: CORS });
  }
  const link = `${siteUrl()}/c/${r.codigo}`;
  return NextResponse.json(
    {
      resultado: r.resultado, codigo: r.codigo, link, inicio: inicio.toISOString(), fim: fim.toISOString(),
      googleAgenda: linkGoogleAgenda({ titulo: nomeEmpresa() ? `Call com ${nomeEmpresa()}` : "Sua call", inicio, fim, detalhes: `Entre pelo link: ${link}` }),
    },
    { headers: CORS },
  );
}
