# Kanban del desarrollo

Leyenda: ✅ hecho · 🔄 en curso · ⏳ pendiente

## ✅ Done
| # | Tarea | Fase |
|---|-------|------|
| 1 | Investigar formato `~/.claude` (projects/*.jsonl, sessions/<pid>.json, agents/*.md) | 0 |
| 2 | Investigar CLI (`-p`, `stream-json`, `--resume`, `--agent`, `--permission-mode`) | 0 |
| 3 | Elegir stack: Next.js 16 + Tailwind 4 + shadcn/ui + Motion | 0 |
| 4 | Scaffold Next.js (App Router, TS, `src/`) | 1 |
| 5 | Almacén JSON atómico en `~/.agentic` | 1 |
| 6 | Seguridad: token + cookie HttpOnly/Strict, Host allow-list, Origin/Sec-Fetch-Site, JSON-only, CSP con nonce | 1 |
| 7 | `proxy.ts` + `/auth` + wrapper `route()` con defensa en profundidad | 1 |
| 8 | Launcher `scripts/agentic.mjs` (bind loopback, URL con token, rotación) | 1 |
| 9 | Índice de sesiones con caché + procesos vivos + transcripciones | 2 |
| 10 | RunManager: headless (stream-json), tmux, stop, logs incrementales, límites | 3 |
| 11 | CRUD de subagentes (usuario y proyecto) | 3 |
| 12 | Tareas (kanban) + plantillas con variables + "ejecutar con Claude" | 4 |
| 13 | Proyectos: descubrimiento, registro, ficha git/CLAUDE.md/scripts | 5 |
| 14 | API REST completa (Route Handlers) | 1-5 |
| 15 | Tests backend (store, security, sessions, agents, tasks, runs, projects, API) | 7 |

## 🔄 In progress
| # | Tarea | Fase |
|---|-------|------|
| 16 | UI: shell (sidebar, tema oscuro, paleta Ctrl+K) | 6 |

## ⏳ To do
| # | Tarea | Fase |
|---|-------|------|
| 17 | UI: Dashboard | 6 |
| 18 | UI: Sesiones + visor de transcripción | 6 |
| 19 | UI: Ejecuciones (lanzar, log en vivo, tmux) | 6 |
| 20 | UI: Agentes | 6 |
| 21 | UI: Kanban con drag & drop + plantillas | 6 |
| 22 | UI: Proyectos + ficha | 6 |
| 23 | UI: Ajustes / sistema | 6 |
| 24 | Smoke test E2E en navegador (Playwright) | 7 |
| 25 | Build de producción + lint + typecheck | 7 |
| 26 | `SECURITY.md` + README | 7 |
