"use strict";

const msg = document.getElementById("msg");
const retry = document.getElementById("retry");

window.agenticLock.onState((state) => {
  document.body.dataset.state = state;
  if (state === "waiting") msg.textContent = "Usa Touch ID para desbloquear.";
  else if (state === "ok") msg.textContent = "Desbloqueada. Abriendo…";
  else {
    msg.textContent = "No se ha verificado Touch ID.";
    retry.focus();
  }
});
retry.addEventListener("click", () => window.agenticLock.retry());
document.getElementById("quit").addEventListener("click", () => window.agenticLock.quit());
