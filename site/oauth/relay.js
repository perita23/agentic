// OAuth relay: providers (Slack requires HTTPS) redirect here, and we forward
// the browser to Agentic on THIS computer (http://localhost:<port>). The port
// travels as the prefix of `state`; the random rest of `state` is what the local
// server checks. Only localhost is ever a destination, and nothing is stored.
"use strict";

(function () {
  var q = new URLSearchParams(location.search);
  var m = /^(\d{2,5})\./.exec(q.get("state") || "");
  var port = m ? Number(m[1]) : 0;
  if (port >= 1024 && port <= 65535 && (q.has("code") || q.has("error"))) {
    location.replace("http://localhost:" + port + "/api/integrations/oauth/callback" + location.search);
    return;
  }
  document.getElementById("title").textContent = "Enlace no válido";
  document.getElementById("detail").textContent = "Vuelve a Agentic y pulsa «Conectar» otra vez.";
})();
