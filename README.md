# ◆ Agentic Console

Consola **web local** para gestionar Claude Code en tu máquina, con estética oscura tipo GitHub / Cursor.

- **Sesiones** — todas las conversaciones de `~/.claude`, estado en vivo (trabajando / esperando), visor de transcripciones con tokens y herramientas, comando para reanudar.
- **Ejecuciones** — lanza Claude Code *headless* (log en vivo, coste, parar) o *interactivo en tmux* (ver pantalla, enviar mensajes, `tmux attach`). Continúa cualquier sesión con `--resume`.
- **Agentes** — crea/edita subagentes de usuario (`~/.claude/agents`) y de proyecto (`.claude/agents`), y lánzalos.
- **Tareas** — tablero Kanban con drag & drop, prioridades, etiquetas, checklist, fecha límite y botón *Ejecutar con Claude* (la tarea pasa a *En curso* y luego a *Revisión*).
- **Plantillas** — plantillas con variables `{{var}}` para crear tareas y prompts (bug, feature, review, tests, refactor, auditoría…).
- **Proyectos** — detectados desde tus sesiones o registrados a mano; ficha con git (rama, commits, cambios), `CLAUDE.md`, scripts, stack, sesiones, tareas y agentes.
- **Paleta de comandos** `Ctrl/⌘ K`, atajo `N` para nueva sesión.

Todo corre en tu ordenador: el servidor sólo escucha en `127.0.0.1` y los datos se guardan en `~/.agentic/`.

## Requisitos

- Node.js ≥ 20.9
- [Claude Code](https://code.claude.com) instalado (`claude` en el `PATH`)
- Opcional: `tmux` para sesiones interactivas, `git` para la ficha de proyectos

## Arranque

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

La terminal muestra un enlace del tipo `http://127.0.0.1:4317/auth?token=…`. Ábrelo una vez: el navegador guarda una cookie segura y ya puedes usar `http://127.0.0.1:4317`.

Modo desarrollo (recarga en caliente):

```bash
npm run dev
```

¿Perdiste el enlace? `npm run url`. ¿Quieres cerrar todas las sesiones del navegador? `npm run rotate-token` y reinicia.

### Configuración (variables de entorno)

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `PORT` | `4317` | Puerto |
| `HOST` | `127.0.0.1` | Interfaz (otra distinta de loopback exige `AGENTIC_ALLOW_REMOTE=1`) |
| `AGENTIC_HOME` | `~/.agentic` | Datos de la app (tareas, plantillas, proyectos, logs, token) |
| `CLAUDE_HOME` | `~/.claude` | Datos de Claude Code |
| `CLAUDE_BIN` | `claude` | Binario de Claude Code |
| `AGENTIC_MAX_RUNS` | `4` | Ejecuciones headless simultáneas |
| `AGENTIC_MAX_LOG_BYTES` | `10485760` | Tamaño máximo del log de cada ejecución |
| `AGENTIC_ALLOWED_HOSTS` | — | Hostnames extra aceptados (coma) |

## Dónde están tus datos

```
~/.agentic/
├── token            # token de acceso (0600)
├── tasks.json       # tablero
├── templates.json   # plantillas
├── projects.json    # proyectos registrados
├── runs.json        # historial de ejecuciones
└── runs/<id>.ndjson # salida de cada ejecución
```

Son JSON legibles, escritos de forma atómica; puedes versionarlos o hacer backup copiando la carpeta.

## Stack

Next.js 16 (App Router, Route Handlers en runtime Node, `proxy.ts`) · React 19 · Tailwind CSS 4 · shadcn/ui (Radix) · Motion · dnd-kit · SWR · zod · Vitest · Playwright.

## Calidad

```bash
npm run check
```

(typecheck + lint + 47 tests unitarios/integración), y el smoke test E2E en Chromium sobre la build de producción:

```bash
npm run build && npm run smoke
```

## Documentación

- [`docs/RESEARCH.md`](docs/RESEARCH.md) — cómo guarda Claude Code sus datos y decisiones de arquitectura
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — fases del proyecto
- [`docs/KANBAN.md`](docs/KANBAN.md) — estado de las tareas
- [`docs/SECURITY.md`](docs/SECURITY.md) — modelo de amenazas y medidas de hardening
