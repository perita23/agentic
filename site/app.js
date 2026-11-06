// The download page. It works without JS (the text and the download links are plain HTML); JS adds:
//  - the orb of the app, doing what it does (a copy of its component: the same clock, easing and states),
//  - the sticky orb that follows what you read, soft entrances,
//  - the right Mac build first (when the browser can tell the CPU) and the latest version from the GitHub API.
"use strict";

const REPO = "perita23/agentic-releases";
const ARM = `https://github.com/${REPO}/releases/latest/download/Agentic-arm64.dmg`;
const X64 = `https://github.com/${REPO}/releases/latest/download/Agentic-x64.dmg`;

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------------------------------------------------------- the orb */

/** How fast the orb's clock runs (rad/s) in each state: slow and calm. The speed eases between states. */
const SPEED = { idle: 0.5, thinking: 1.5, writing: 2.4, reading: 2.6, editing: 3.4, running: 4.2, searching: 1.7, waiting: 0.9, done: 0.3, error: 5 };
const LABEL = {
  idle: "En reposo",
  thinking: "Pensando…",
  writing: "Escribiendo la respuesta…",
  reading: "Leyendo ficheros…",
  editing: "Editando ficheros…",
  running: "Ejecutando un comando…",
  searching: "Buscando…",
  waiting: "Esperando tu respuesta",
  done: "Terminado",
};
const SVG = "http://www.w3.org/2000/svg";
let orbCount = 0;

/** Builds an orb inside `host` (same structure and classes as the app's, so orb.css draws it). */
function createOrb(host, size, state) {
  const id = `g${++orbCount}`;
  const orb = document.createElement("span");
  orb.className = "orb";
  orb.dataset.state = state;
  orb.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.setAttribute("focusable", "false");
  svg.innerHTML = `<defs><filter id="${id}" x="-45%" y="-45%" width="190%" height="190%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="${Math.max(1.5, size / 16)}" result="b"/><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"/></filter></defs>`;
  const goo = document.createElement("span");
  goo.className = "orb-goo";
  goo.style.filter = `url(#${id})`;
  const pose = document.createElement("span");
  pose.className = "orb-pose";
  for (let i = 0; i < 8; i++) {
    const b = document.createElement("i");
    b.className = "orb-ball";
    b.style.setProperty("--i", String(i));
    pose.append(b);
  }
  goo.append(pose);
  orb.append(svg, goo);
  host.append(orb);

  let target = SPEED[state];
  let speed = target;
  let t = Math.random() * 20;
  let last = performance.now();
  let raf = 0;
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    speed += (target - speed) * Math.min(1, dt * 1.1);
    t += dt * speed;
    orb.style.setProperty("--t", t.toFixed(3));
    raf = requestAnimationFrame(tick);
  };
  const resize = (px) => {
    orb.style.width = `${px}px`;
    orb.style.height = `${px}px`;
    orb.style.setProperty("--px", `${px}px`);
  };
  resize(size);
  if (!reduce) {
    // Only while it is on screen.
    new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf);
      if (e.isIntersecting) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    }).observe(host);
  }
  return {
    resize,
    set(s) {
      orb.dataset.state = s;
      target = SPEED[s];
    },
  };
}

/** A status line that morphs: the old words blur out while the new ones blur in (and glow in the state's colours). */
function createStatus(el, text, state) {
  const grid = document.createElement("div");
  grid.className = "grid";
  const first = document.createElement("span");
  first.className = "orb-text";
  first.dataset.state = state;
  first.textContent = text;
  grid.append(first);
  el.replaceChildren(grid);
  let current = first;
  return (next, st) => {
    if (current.textContent === next) {
      current.dataset.state = st;
      return;
    }
    const old = current;
    old.className = "orb-text morph-out";
    old.setAttribute("aria-hidden", "true");
    const fresh = document.createElement("span");
    fresh.className = "orb-text morph-in";
    fresh.dataset.state = st;
    fresh.textContent = next;
    grid.append(fresh);
    current = fresh;
    setTimeout(() => old.remove(), 450);
  };
}

const root = document.documentElement;
const glow = (state) => {
  root.dataset.orb = state;
};

/* ---------------------------------------------------------------- hero */

const TOUR = ["thinking", "reading", "searching", "editing", "running", "writing", "waiting", "done"];

function initHero() {
  const host = document.getElementById("hero-orb");
  const statusEl = document.getElementById("hero-status");
  if (!host || !statusEl) return;
  const size = () => Math.round(Math.min(320, Math.max(210, window.innerWidth * 0.52)));
  const orb = createOrb(host, size(), "thinking");
  const morph = createStatus(statusEl, LABEL.thinking, "thinking");
  const chips = [...document.querySelectorAll(".chip")];
  let index = 0;
  let pausedUntil = 0;
  let visible = true;
  glow("thinking");

  const show = (state) => {
    index = Math.max(0, TOUR.indexOf(state));
    orb.set(state);
    morph(LABEL[state], state);
    if (visible) glow(state);
    for (const c of chips) c.setAttribute("aria-pressed", String(c.dataset.state === state));
  };
  for (const c of chips) {
    c.addEventListener("click", () => {
      pausedUntil = Date.now() + 14000; // you choose: it stays a while
      show(c.dataset.state);
    });
  }
  host.addEventListener("click", () => {
    pausedUntil = Date.now() + 14000;
    show(TOUR[(index + 1) % TOUR.length]);
  });
  host.style.cursor = "pointer";

  setInterval(() => {
    if (document.hidden || !visible || Date.now() < pausedUntil) return;
    show(TOUR[(index + 1) % TOUR.length]);
  }, 3800);

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) glow(TOUR[index]);
  }).observe(document.querySelector(".hero"));

  // The orb leans a little towards the pointer.
  if (!reduce && window.matchMedia("(pointer: fine)").matches) {
    const hero = document.querySelector(".hero");
    hero.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 3)) / r.height;
      host.style.transform = `translate(${(dx * 26).toFixed(1)}px, ${(dy * 18).toFixed(1)}px)`;
    });
    hero.addEventListener("pointerleave", () => (host.style.transform = ""));
  }
  window.addEventListener("resize", () => orb.resize(size()));
}

/* ---------------------------------------------------------------- story: the orb follows what you read */

function initStory() {
  const host = document.getElementById("story-orb");
  const statusEl = document.getElementById("story-status");
  const steps = [...document.querySelectorAll(".step")];
  if (!host || !statusEl || !steps.length) return;
  const size = () => (window.innerWidth <= 820 ? 140 : 230);
  const orb = createOrb(host, size(), steps[0].dataset.state);
  const morph = createStatus(statusEl, steps[0].dataset.label, steps[0].dataset.state);
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const s = e.target;
        for (const o of steps) o.classList.toggle("on", o === s);
        orb.set(s.dataset.state);
        morph(s.dataset.label, s.dataset.state);
        glow(s.dataset.state);
      }
    },
    { rootMargin: "-42% 0px -42% 0px" },
  );
  for (const s of steps) io.observe(s);
  window.addEventListener("resize", () => orb.resize(size()));
}

function initDownloadOrb() {
  const host = document.getElementById("download-orb");
  if (!host) return;
  const orb = createOrb(host, 120, "done");
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) {
      glow("done");
      orb.set("done");
    }
  }, { threshold: 0.35 }).observe(host);
}

/* ---------------------------------------------------------------- soft entrances */

function initReveal() {
  const els = [...document.querySelectorAll("[data-reveal]")];
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.remove("reveal-hide");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  for (const el of els) {
    if (el.getBoundingClientRect().top > window.innerHeight * 0.92) el.classList.add("reveal-hide");
    io.observe(el);
  }
}

/* ---------------------------------------------------------------- downloads */

async function detectIntel() {
  // Only Chromium exposes the CPU; Safari/Firefox report "Intel" for every Mac, so Apple Silicon stays the default.
  try {
    const d = await navigator.userAgentData?.getHighEntropyValues?.(["architecture", "platform"]);
    return d?.platform === "macOS" && d?.architecture === "x86";
  } catch {
    return false;
  }
}

async function initDownloads() {
  const primary = document.getElementById("dl-primary");
  const label = document.getElementById("dl-primary-label");
  const secondary = document.getElementById("dl-secondary");
  const arm = document.getElementById("dl-arm");
  const x64 = document.getElementById("dl-x64");
  if (await detectIntel()) {
    primary.href = X64;
    label.textContent = "Descargar para Mac (Intel)";
    secondary.href = ARM;
    secondary.textContent = "Mac con Apple Silicon";
    arm?.classList.remove("primary");
    x64?.classList.add("primary");
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
    if (!res.ok) return;
    const rel = await res.json();
    const date = new Date(rel.published_at).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
    const tag = String(rel.tag_name).replace(/[^\w.-]/g, "");
    for (const id of ["release-meta", "release-meta-2"]) {
      const el = document.getElementById(id);
      if (el) el.textContent = `${tag} · ${date} · macOS 13 o superior · se actualiza sola`;
    }
  } catch {
    // offline or rate limited: keep the static text
  }
}

initHero();
initStory();
initDownloadOrb();
initReveal();
void initDownloads();
