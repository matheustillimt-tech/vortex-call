import { Download, Play } from "lucide-react";
import { estiloBotaoIcone } from "../_componentes/ui";

/** "Assistir" abre o link da gravação (assinado no R2 ou pedido na hora ao RealtimeKit) numa aba nova; "Baixar" é o
 *  mesmo link com `?baixar=1` (no R2 o link já baixa como `gravacao.mp4`). A rota confere login e redireciona (302)
 *  ou mostra a página de "expirada" (404) se a gravação da Cloudflare já passou dos 7 dias. */
export function AcoesGravacao({ id }: { id: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <a href={`/api/gravacoes/${id}/link`} target="_blank" rel="noopener noreferrer" aria-label="Assistir" title="Assistir" className={estiloBotaoIcone("tabela", "marca")}>
        <Play size={20} aria-hidden />
      </a>
      <a href={`/api/gravacoes/${id}/link?baixar=1`} download target="_blank" rel="noopener noreferrer" aria-label="Baixar" title="Baixar" className={estiloBotaoIcone("tabela", "neutro")}>
        <Download size={20} aria-hidden />
      </a>
    </span>
  );
}
