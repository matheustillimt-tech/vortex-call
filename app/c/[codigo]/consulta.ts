import type { EstadoSala } from "@/src/lib/regras/estado-sala";

/** Intervalo até a próxima consulta de `GET /api/sala/estado/{codigo}`, em ms. Em `espera`, acompanha o quanto
 *  falta pra abrir (entre 5s e 60s); em `aguardando_anfitriao`, fixo em 5s (o anfitrião pode abrir em qualquer
 *  momento); `aberta`, `acabou` e `cancelada` não consultam mais (a tela já decidiu o que mostrar). */
export function proximaConsulta(estado: EstadoSala, msAteAbrir: number): number {
  if (estado === "espera") return Math.min(60_000, Math.max(5_000, msAteAbrir));
  if (estado === "aguardando_anfitriao") return 5_000;
  return 0;
}
