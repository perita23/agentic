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

// The orb: one clock (--t) at a per-state speed that eases, and a new state every two to three seconds
// so every shape shows up (same behaviour as the app's LiquidOrb).
(() => {
  const orb = $("orb");
  const SPEED = { idle: 0.5, thinking: 1.5, writing: 2.4, reading: 2.6, editing: 3.4, running: 4.2, searching: 1.7, waiting: 0.9, done: 0.3, error: 5 };
  const TOUR = ["thinking", "writing", "running", "reading", "editing", "searching", "waiting", "done", "error", "idle"];
  let i = 0;
  const next = () => {
    i = (i + 1) % TOUR.length;
    orb.dataset.state = TOUR[i];
    setTimeout(next, 2000 + Math.random() * 1000);
  };
  setTimeout(next, 2000 + Math.random() * 1000);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let last = performance.now();
  let speed = SPEED.thinking;
  let t = Math.random() * 20;
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    speed += (SPEED[orb.dataset.state] - speed) * Math.min(1, dt * 2.2);
    t += dt * speed;
    orb.style.setProperty("--t", t.toFixed(3));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
