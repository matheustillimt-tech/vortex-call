"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageSquareText, RefreshCw, Sparkles } from "lucide-react";
import { useRealtimeKitMeeting } from "@cloudflare/realtimekit-react";
import type { EstadoResumo, Ficha } from "@/src/lib/ficha";
import { mensagensDaPessoa } from "@/src/lib/regras/coluna";

type Props = { sessaoId: string; inscricaoId: string; userIds: string[]; voltar: () => void };
type Resumo = EstadoResumo | { estado: "gerando" } | { estado: "falhou"; mensagem: string; podeTentar: boolean };
type Salvamento = "parado" | "salvando" | "salvo" | "erro";

/** Ficha de uma pessoa: dados da inscrição (servidor), resumo por IA (gerado na primeira abertura), o que ela
 *  escreveu no chat desta call (só do navegador) e observações da equipe (salvam sozinhas). */
export function FichaPessoa({ sessaoId, inscricaoId, userIds, voltar }: Props) {
  const base = `/api/sala/ficha/${sessaoId}/${inscricaoId}`;
  const { meeting } = useRealtimeKitMeeting();
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [observacoes, setObservacoes] = useState("");
  const [salvamento, setSalvamento] = useState<Salvamento>("parado");
  // `texto` é sempre o último valor digitado (lido no disparo do timer, no blur e ao desmontar); `salvas` é o
  // último texto confirmado pelo servidor. `contagem` numera os PUTs: só a resposta do PUT mais recente pode
  // atualizar `salvas`/status, pra uma resposta atrasada não sobrescrever um texto mais novo já salvo.
  const texto = useRef("");
  const salvas = useRef("");
  const contagem = useRef(0);
  const [, setVersaoChat] = useState(0);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch(base, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const f = (await r.json()) as Ficha;
        if (cancelado) return;
        salvas.current = f.observacoes;
        texto.current = f.observacoes;
        setFicha(f);
        setObservacoes(f.observacoes);
        setResumo(f.resumo);
      } catch {
        if (!cancelado) setErro(true);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [base, tentativa]);

  const gerarResumo = useCallback(async () => {
    setResumo({ estado: "gerando" });
    try {
      const r = await fetch(`${base}/resumo`, { method: "POST" });
      const j = (await r.json().catch(() => null)) as { estado?: string; texto?: string; erro?: string } | null;
      if (r.ok && j?.estado === "pronto" && j.texto) {
        setResumo({ estado: "pronto", texto: j.texto });
        return;
      }
      if (r.ok && j?.estado === "sem_dados") {
        setResumo({ estado: "sem_dados" });
        return;
      }
      setResumo({ estado: "falhou", mensagem: j?.erro ?? "Não deu pra gerar o resumo agora.", podeTentar: r.status !== 503 });
    } catch {
      setResumo({ estado: "falhou", mensagem: "Não deu pra gerar o resumo agora.", podeTentar: true });
    }
  }, [base]);

  useEffect(() => {
    if (resumo?.estado === "pendente") void gerarResumo();
  }, [resumo, gerarResumo]);

  const salvarObservacoes = useCallback(
    async (valor: string) => {
      const id = ++contagem.current;
      setSalvamento("salvando");
      try {
        const r = await fetch(`${base}/observacoes`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto: valor }),
        });
        if (!r.ok) throw new Error(String(r.status));
        if (id !== contagem.current) return; // uma resposta mais nova já chegou
        salvas.current = valor;
        setSalvamento("salvo");
      } catch {
        if (id === contagem.current) setSalvamento("erro");
      }
    },
    [base],
  );

  // Salva 1 s depois de parar de digitar. Confere de novo no disparo (não ao agendar): se o blur já salvou o
  // mesmo texto enquanto o timer esperava, não manda PUT duplicado.
  useEffect(() => {
    if (!ficha || observacoes === salvas.current) return;
    const t = window.setTimeout(() => {
      if (texto.current !== salvas.current) void salvarObservacoes(texto.current);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [observacoes, ficha, salvarObservacoes]);

  // Sai sem passar pelo onBlur (troca de aba, "Fechar ficha", convidado saindo, fechar a aba): manda o último
  // texto digitado com keepalive, sem esperar resposta nem tocar em estado (o componente já foi desmontado).
  useEffect(() => {
    function mandarSeMudou() {
      if (texto.current === salvas.current) return;
      fetch(`${base}/observacoes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: texto.current }),
        keepalive: true,
      }).catch(() => {});
    }
    window.addEventListener("pagehide", mandarSeMudou);
    return () => {
      window.removeEventListener("pagehide", mandarSeMudou);
      mandarSeMudou();
    };
  }, [base]);

  // Chat: re-renderiza a cada mensagem nova; nada vai pro servidor.
  useEffect(() => {
    const aoMudar = () => setVersaoChat((v) => v + 1);
    meeting.chat.on("chatUpdate", aoMudar);
    return () => {
      meeting.chat.removeListener("chatUpdate", aoMudar);
    };
  }, [meeting]);
  const conversa = mensagensDaPessoa(meeting.chat.messages, userIds);

  function sair() {
    // O efeito de desmontagem cuida de salvar o que faltar (fire-and-forget), já que o componente sai da
    // árvore no mesmo instante que `voltar()` roda.
    voltar();
  }

  const topo = (
    <div className="flex items-center gap-2 border-b border-zinc-100 px-2 py-2">
      <button
        type="button"
        onClick={sair}
        aria-label="Voltar pra lista"
        className="grid size-8 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
      >
        <ArrowLeft className="size-4" />
      </button>
      <h3 className="truncate text-sm font-semibold text-zinc-900">{ficha?.nome ?? "Ficha"}</h3>
    </div>
  );

  if (erro) {
    return (
      <div>
        {topo}
        <div className="space-y-3 p-4">
          <p className="text-sm text-zinc-600">Não deu pra abrir a ficha.</p>
          <button
            type="button"
            onClick={() => {
              setErro(false);
              setTentativa((n) => n + 1);
            }}
            className="rounded-md bg-marca px-3 py-1.5 text-sm font-medium text-white hover:bg-marca-escura"
          >
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  if (!ficha) {
    return (
      <div>
        {topo}
        <p className="p-4 text-sm text-zinc-500">Abrindo a ficha…</p>
      </div>
    );
  }

  return (
    <div>
      {topo}
      <div className="space-y-5 p-4">
        {ficha.ultimaCall && (
          <Secao titulo="Alinhado na última call" icone={<MessageSquareText className="size-3.5" />}>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-zinc-800">{ficha.ultimaCall.texto}</pre>
            {ficha.ultimaCall.em && <p className="mt-1 text-[11px] text-zinc-400">Resumo de {ficha.ultimaCall.em}</p>}
          </Secao>
        )}
        <Secao titulo="Resumo por IA" icone={<Sparkles className="size-3.5" />}>
          {resumo?.estado === "pronto" && <p className="text-sm leading-relaxed text-zinc-800">{resumo.texto}</p>}
          {(resumo?.estado === "gerando" || resumo?.estado === "pendente") && <p className="text-sm text-zinc-500">Gerando resumo…</p>}
          {resumo?.estado === "sem_dados" && <p className="text-sm text-zinc-500">Sem dados pra resumir.</p>}
          {resumo?.estado === "falhou" && (
            <div className="space-y-2">
              <p className="text-sm text-zinc-500">{resumo.mensagem}</p>
              {resumo.podeTentar && (
                <button
                  type="button"
                  onClick={() => void gerarResumo()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <RefreshCw className="size-3.5" /> Tentar de novo
                </button>
              )}
            </div>
          )}
        </Secao>

        <Secao titulo="Contato">
          <dl className="space-y-1.5 text-sm">
            <Linha rotulo="WhatsApp">
              {ficha.contatoMascarado || !ficha.linkWhatsapp ? (
                <span title="Contato completo só com a permissão do admin">{ficha.whatsapp}</span>
              ) : (
                <a href={ficha.linkWhatsapp} target="_blank" rel="noreferrer" className="text-marca hover:text-marca-escura">
                  {ficha.whatsapp}
                </a>
              )}
            </Linha>
            <Linha rotulo="E-mail">
              {!ficha.email ? (
                "Não informado"
              ) : ficha.contatoMascarado ? (
                <span className="break-all">{ficha.email}</span>
              ) : (
                <a href={`mailto:${ficha.email}`} className="break-all text-marca hover:text-marca-escura">
                  {ficha.email}
                </a>
              )}
            </Linha>
            <Linha rotulo="Origem">{ficha.origem}</Linha>
            {ficha.utm.map((u) => (
              <Linha key={u.rotulo} rotulo={u.rotulo}>
                {u.valor}
              </Linha>
            ))}
            <Linha rotulo="Inscrição">{ficha.inscritoEm}</Linha>
          </dl>
        </Secao>

        <Secao titulo="Respostas do formulário">
          {ficha.respostas.length === 0 ? (
            <p className="text-sm text-zinc-500">Sem respostas de formulário.</p>
          ) : (
            <dl className="space-y-2.5 text-sm">
              {ficha.respostas.map((p, i) => (
                <div key={i}>
                  <dt className="text-zinc-500">{p.pergunta}</dt>
                  <dd className="whitespace-pre-wrap break-words text-zinc-800">{p.resposta}</dd>
                </div>
              ))}
            </dl>
          )}
        </Secao>

        <Secao titulo="Sessões anteriores">
          {ficha.anteriores.length === 0 ? (
            <p className="text-sm text-zinc-500">Primeira sessão dessa pessoa.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {ficha.anteriores.map((s, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 text-zinc-800">
                    {s.quando} <span className="text-zinc-500">· {s.agenda}</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-zinc-600">{s.situacao}</span>
                </li>
              ))}
            </ul>
          )}
        </Secao>

        <Secao titulo="No chat desta call">
          {conversa.length === 0 ? (
            <p className="text-sm text-zinc-500">Ainda não escreveu no chat.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {conversa.map((m) => (
                <li key={m.id} className="break-words text-zinc-800">
                  <span className="mr-1.5 font-mono text-xs text-zinc-400">{m.hora}</span>
                  {m.privada && <span className="mr-1 text-xs font-medium text-zinc-500">(privada)</span>}
                  {m.texto}
                </li>
              ))}
            </ul>
          )}
        </Secao>

        <Secao titulo="Observações">
          {ficha.observacoesTravadas && (
            <p className="mb-1 text-xs text-zinc-500">Tem contato do lead aqui: só leitura (o admin libera o contato completo).</p>
          )}
          <textarea
            readOnly={ficha.observacoesTravadas}
            value={observacoes}
            onChange={(e) => {
              texto.current = e.target.value;
              setObservacoes(e.target.value);
              setSalvamento("parado");
            }}
            onBlur={() => {
              if (texto.current !== salvas.current) void salvarObservacoes(texto.current);
            }}
            maxLength={10000}
            rows={5}
            placeholder="Anote o que importa sobre essa pessoa…"
            className="w-full resize-y rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-marca"
          />
          <p className="mt-1 h-4 text-xs text-zinc-500" role="status">
            {salvamento === "salvando" && "Salvando…"}
            {salvamento === "salvo" && "Salvo"}
            {salvamento === "erro" && (
              <>
                Não salvou.{" "}
                <button type="button" onClick={() => void salvarObservacoes(texto.current)} className="font-medium text-marca hover:text-marca-escura">
                  Tentar de novo
                </button>
              </>
            )}
          </p>
        </Secao>
      </div>
    </div>
  );
}

function Secao({ titulo, icone, children }: { titulo: string; icone?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {icone}
        {titulo}
      </h4>
      {children}
    </section>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-zinc-500">{rotulo}</dt>
      <dd className="min-w-0 flex-1 break-words text-zinc-800">{children}</dd>
    </div>
  );
}
