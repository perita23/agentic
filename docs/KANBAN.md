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
| 15 | Tests backend (store, security, sessions, agents, tasks, runs, projects, API) — 47 tests | 7 |
| 16 | UI: shell (sidebar animada, tema oscuro GitHub, paleta Ctrl+K, atajo N) | 6 |
| 17 | UI: Dashboard | 6 |
| 18 | UI: Sesiones + visor de transcripción | 6 |
| 19 | UI: Ejecuciones (lanzar, log en vivo, consola tmux) | 6 |
| 20 | UI: Agentes | 6 |
| 21 | UI: Kanban con drag & drop + plantillas | 6 |
| 22 | UI: Proyectos + ficha | 6 |
| 23 | UI: Ajustes / sistema | 6 |
| 24 | Smoke test E2E en navegador (Playwright, 24 comprobaciones, estable 3/3) | 7 |
| 25 | Build de producción + lint + typecheck | 7 |
| 26 | `SECURITY.md` + README + `npm audit` | 7 |

## Iteración 2 (PRs autónomas)
| # | Tarea | PR | Estado |
|---|-------|----|--------|
| 27 | Review de la v1: fix de PATCH que borraba campos al mover tareas | #1 | ✅ |
| 28 | Tema oscuro estilo Cursor | #2 | ✅ |
| 29 | CI en GitHub Actions (typecheck, lint, tests, build, smoke E2E, audit) | #3 | ✅ |
| 30 | Diff git por ejecución + endurecimiento de git contra filtros/textconv | #4 | ✅ v0.2.0 |
| 31 | Notificaciones de escritorio al terminar una ejecución | #4 | ✅ v0.2.0 |
| 31b | Releases automáticas (tag + GitHub Release al pasar CI en main) | #4 | ✅ v0.2.0 |
| 32 | Analítica de uso (tokens por día / proyecto / modelo / herramienta) | #5 | ✅ v0.3.0 |
| 33 | Cola de tareas autónoma (ejecutar To do en secuencia) | #6 | ✅ v0.4.0 |
| 35 | Búsqueda de texto completo dentro de transcripciones | #6 | ✅ v0.4.0 |

## Épica: integraciones (GitHub, Bitbucket, Jira, Slack)
| # | Tarea | Versión | Estado |
|---|-------|---------|--------|
| 40 | Framework: credenciales locales 0600 nunca expuestas, cliente HTTP seguro (https, timeout, sin redirecciones, tope de tamaño) | v0.5.0 | ✅ |
| 41 | Slack: canales, leer historial e hilos, enviar y responder, avisos de ejecuciones/cola | v0.5.0 | ✅ |
| 42 | Pull Requests GitHub + Bitbucket: bandeja, detalle (diff, checks, reviews, comentarios), comentar, aprobar/pedir cambios, merge, cerrar | v0.6.0 | ✅ |
| 43 | Jira: incidencias por JQL, detalle y comentarios, comentar, transiciones, importar como tarea | v0.7.0 | 🔄 |
| 44 | Confluence: buscar páginas y usarlas como contexto del prompt | backlog | ⏳ |

## ⏳ Backlog
| # | Tarea |
|---|-------|
| 34 | Streaming por SSE en lugar de polling |
| 36 | Empaquetado como app de escritorio (Tauri) |
