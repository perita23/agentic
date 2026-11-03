"use strict";

const $ = (id) => document.getElementById(id);
const TITLE = {
  setup: "Bienvenido a Agentic",
  password: "Agentic está bloqueada",
  touchid: "Agentic está bloqueada",
  ok: "Desbloqueada",
};
const HINT = {
  setup: "Crea una contraseña para proteger la app. Después podrás activar Touch ID en Ajustes.",
  password: "Introduce tu contraseña.",
  touchid: "Usa Touch ID para desbloquear.",
  ok: "Abriendo…",
};

window.agenticLock.onState(({ state, message, canTouch }) => {
  document.body.dataset.state = state;
  $("title").textContent = TITLE[state] || "Agentic";
  $("hint").textContent = HINT[state] || "";
  $("error").textContent = message;
  $("use-touch").hidden = !(state === "password" && canTouch);
  for (const b of document.querySelectorAll("button, input")) b.disabled = state === "ok";
  if (state === "setup") ($("new1").value ? $("new2") : $("new1")).focus();
  if (state === "password") {
    $("pw").value = "";
    $("pw").focus();
  }
});

$("setup-form").addEventListener("submit", (e) => {
  e.preventDefault();
  window.agenticLock.createPassword($("new1").value, $("new2").value);
});
$("password-form").addEventListener("submit", (e) => {
  e.preventDefault();
  window.agenticLock.submitPassword($("pw").value);
});
$("use-touch").addEventListener("click", () => window.agenticLock.useTouchId());
$("use-password").addEventListener("click", () => {
  document.body.dataset.state = "password";
  $("hint").textContent = HINT.password;
  $("pw").focus();
});
for (const b of document.querySelectorAll("[data-quit]")) b.addEventListener("click", () => window.agenticLock.quit());
