// Tabela "Vendedores" do Início (server component): uma linha por vendedor (quem conduziu a sessão como anfitrião,
// senão o responsável da agenda). Admin vê todos; o membro vê só a própria linha ("Seus resultados").
import { BadgeCheck } from "lucide-react";
import type { VendedorDashboard } from "@/src/lib/dashboard";
import { formatarAntecedencia, formatarReais, indicadoresVendedor } from "@/src/lib/regras/dashboard";
import { Cartao, Tabela, estiloCelula } from "../ui";
import { NotaSelo } from "./nota-selo";

const COLUNAS = [
  "Vendedor", "Realizadas", "Conduzidas", "Sem anfitrião", "Entrada (média)", "Inscritos", "Vieram", "Comparecimento",
  "Interagiram", "Nota média",
];
/** Só com a permissão `receita`. */
const COLUNAS_RECEITA = ["Compraram", "Receita", "Conversão", "Ticket médio"];

const num = `${estiloCelula} tabular-nums whitespace-nowrap`;

export function TabelaVendedores({ linhas, titulo, verReceita = true }: { linhas: VendedorDashboard[]; titulo: string; verReceita?: boolean }) {
  return (
    <Cartao
      titulo={titulo}
      icone={BadgeCheck}
      ajuda={`Cada sessão conta pra quem entrou primeiro como anfitrião; sem anfitrião, pro responsável da agenda. Entrada = minutos antes do início em que ele entrou nas que conduziu.${verReceita ? " Conversão = compraram ÷ vieram." : ""}`}
    >
      <Tabela colunas={verReceita ? [...COLUNAS, ...COLUNAS_RECEITA] : COLUNAS} semBorda vazio={linhas.length ? undefined : "Nenhuma sessão de vendedor neste filtro."}>
        {linhas.map((v) => {
          const ind = indicadoresVendedor(v);
          return (
            <tr key={v.vendedor_id ?? "sem"}>
              <td className={`${estiloCelula} whitespace-nowrap font-medium`}>{v.nome ?? <span className="text-texto-3">Sem vendedor</span>}</td>
              <td className={num}>{v.realizadas}</td>
              <td className={num}>{v.conduzidas}</td>
              <td className={`${num} ${v.sem_anfitriao > 0 ? "text-aviso" : ""}`}>{v.sem_anfitriao}</td>
              <td className={num}>{formatarAntecedencia(v.antecedencia_media_min)}</td>
              <td className={num}>{v.inscritos}</td>
              <td className={num}>{v.vieram}</td>
              <td className={num}>{ind.comparecimento}</td>
              <td className={num}>{v.interagiram}</td>
              <td className={estiloCelula}>{v.vieram > 0 && v.nota_media !== null ? <NotaSelo nota={v.nota_media} /> : "—"}</td>
              {verReceita && (
                <>
                  <td className={num}>{v.compraram || "—"}</td>
                  <td className={num}>{v.receita_centavos > 0 ? formatarReais(v.receita_centavos) : "—"}</td>
                  <td className={num}>{ind.conversao}</td>
                  <td className={num}>{ind.ticket}</td>
                </>
              )}
            </tr>
          );
        })}
      </Tabela>
    </Cartao>
  );
}
