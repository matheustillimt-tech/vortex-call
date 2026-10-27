/** Script que outra página (formulário, landing, site) carrega para mostrar o módulo de agendamento. */
export function montarScript(site: string): string {
  return `(function () {
  var SITE = ${JSON.stringify(site)};
  var eu = document.currentScript;
  if (!eu) return;
  var agenda = eu.getAttribute("data-agenda");
  if (!agenda) { console.error("[Vórtex Call] falta data-agenda no script"); return; }
  var q = new URLSearchParams({ embed: "1" });
  [["nome", "data-nome"], ["whatsapp", "data-whatsapp"], ["email", "data-email"], ["r", "data-resposta"]].forEach(function (p) {
    var v = eu.getAttribute(p[1]); if (v) q.set(p[0], v);
  });
  var aqui = new URLSearchParams(location.search);
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) { var v = aqui.get(k); if (v) q.set(k, v); });
  var url = SITE + "/agendar/" + encodeURIComponent(agenda);
  var frame = document.createElement("iframe");
  frame.src = url + "?" + q.toString();
  frame.title = "Agendar call";
  frame.style.cssText = "width:100%;max-width:480px;border:0;height:520px;display:block;margin:0 auto;background:transparent";
  frame.setAttribute("allow", "clipboard-write");
  var alvo = null;
  var seletorAlvo = eu.getAttribute("data-alvo");
  if (seletorAlvo) {
    try { alvo = document.querySelector(seletorAlvo); }
    catch (err) { console.error("[Vórtex Call] data-alvo inválido, usando o lugar padrão", err); }
  }
  if (alvo) alvo.appendChild(frame); else eu.parentNode.insertBefore(frame, eu.nextSibling);
  var carregou = false;
  frame.addEventListener("load", function () { carregou = true; });
  setTimeout(function () {
    if (carregou) return;
    var a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener";
    a.textContent = "Agenda indisponível aqui. Toque para agendar pelo link.";
    a.style.cssText = "display:block;text-align:center;padding:16px";
    frame.replaceWith(a);
  }, 8000);
  window.addEventListener("message", function (e) {
    if (e.origin !== SITE || e.source !== frame.contentWindow || !e.data) return;
    if (e.data.tipo === "vortex-call:altura") frame.style.height = Math.min(Math.max(e.data.altura, 200), 2000) + "px";
    if (e.data.tipo === "vortex-call:agendado") window.dispatchEvent(new CustomEvent("vortex-call:agendado", { detail: e.data }));
  });
})();`;
}
