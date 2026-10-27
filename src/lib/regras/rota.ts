/** Caminhos que abrem sem login. Prefixo com "/" no fim casa tudo abaixo dele. */
const PUBLICAS = [
  "/login", "/agendar/", "/agendar.js", "/c/", "/api/agendamento/", "/api/cron/",
  "/api/sala/estado/", "/api/sala/convidado/", "/api/sala/atividade/", "/api/webhooks/realtimekit", "/api/webhooks/pay/",
  "/r/", "/api/reunioes/estado/", "/api/reunioes/entrar/",
  "/s/", "/api/convite/",
  "/api/v1/", "/api/mcp",
];

export function rotaPublica(pathname: string): boolean {
  return PUBLICAS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));
}

/** Descoberta automática (`/.well-known/...`) que clientes de MCP tentam antes ou depois de uma chave errada
 *  (ex.: `oauth-authorization-server`). O middleware devolve um 404 em JSON direto, sem tocar no Supabase nem
 *  redirecionar pro login: não é uma tela, e a redireção confundiria o cliente MCP. */
export function ehWellKnown(pathname: string): boolean {
  return pathname.startsWith("/.well-known/");
}

/** O middleware renova o login (cookie do Supabase) nas rotas fechadas e também em `/r/`: a reunião é pública, mas
 *  o membro logado entra como anfitrião e a página precisa do login válido. Nas outras públicas não chama o Supabase. */
export function precisaRenovarSessao(pathname: string): boolean {
  return !rotaPublica(pathname) || pathname.startsWith("/r/");
}
