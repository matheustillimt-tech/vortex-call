// Selo da nota de interação (0 a 100) na cor da faixa: abaixo de 30 vermelho, 30 a 60 âmbar, acima de 60 verde.
import { corDaNota, formatarDecimal, type CorNota } from "@/src/lib/regras/dashboard";
import { Selo, type CorSelo } from "../ui";

const COR: Record<CorNota, CorSelo> = { erro: "erro", aviso: "aviso", ok: "ok" };

export function NotaSelo({ nota }: { nota: number }) {
  return <Selo cor={COR[corDaNota(nota)]}>{formatarDecimal(nota)}</Selo>;
}
