// Tela de quem abriu uma página do painel sem a permissão (Equipe → "Permissões"). O menu já esconde o item; isto é
// pra quem chega pelo link direto.
import { SEM_PERMISSAO } from "@/src/lib/regras/permissoes";
import { Cartao, Pagina, Vazio } from "./ui";

export function SemPermissao({ titulo }: { titulo: string }) {
  return (
    <Pagina titulo={titulo}>
      <Cartao>
        <Vazio comIcone texto={SEM_PERMISSAO} detalhe="O admin libera em Equipe → Permissões." />
      </Cartao>
    </Pagina>
  );
}
