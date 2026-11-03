# Investigación: cómo gestionar Claude Code de forma local

Objetivo: una consola local (estética oscura tipo GitHub / Cursor) para ver y controlar
todas las sesiones de Claude Code de la máquina, lanzar sesiones y agentes nuevos,
planificar tareas con plantillas y ver información de cada proyecto. **Todo local**:
sin cuentas, sin servicios externos, sin telemetría.

## 1. Qué datos deja Claude Code en disco

| Ruta | Contenido | Uso en la app |
|------|-----------|---------------|
| `~/.claude/projects/<cwd-codificado>/<sessionId>.jsonl` | Transcripción completa de cada sesión, una línea JSON por evento (`user`, `assistant`, `attachment`, `queue-operation`, `summary`, …). Cada línea lleva `cwd`, `gitBranch`, `version`, `timestamp`, `sessionId`. Los `assistant` incluyen `message.model` y `message.usage` (tokens). | Historial de sesiones, visor de transcripciones, tokens, descubrimiento de proyectos. |
| `~/.claude/sessions/<pid>.json` | Una ficha por proceso `claude` vivo: `pid`, `sessionId`, `cwd`, `status` (`busy`/`idle`), `kind`, `entrypoint`, `name`, `startedAt`, `updatedAt`. | Detectar **sesiones activas** y su estado en tiempo real (comprobando que el PID siga vivo). |
| `~/.claude/agents/*.md` | Subagentes de usuario: Markdown con front-matter YAML (`name`, `description`, `tools`, `model`) + prompt de sistema. | Gestor de agentes (ámbito usuario). |
| `<proyecto>/.claude/agents/*.md` | Subagentes de proyecto, mismo formato. | Gestor de agentes (ámbito proyecto). |
| `<proyecto>/CLAUDE.md` | Memoria/instrucciones del proyecto. | Ficha de proyecto. |

Notas:
- El nombre del directorio de `projects/` es una codificación **con pérdida** del cwd
  (`/` → `-`), así que el cwd real se lee del campo `cwd` de las líneas del `.jsonl`.
- Los `.jsonl` pueden ser grandes (MB). Para listar sólo se lee la cabecera del fichero
  y se cachea por `(mtime, size)`; el visor lee el fichero entero en streaming.

## 2. Cómo lanzar y controlar sesiones

- **Headless**: `claude -p "<prompt>" --output-format stream-json --verbose`
  emite NDJSON (`system/init` con `session_id`, mensajes `assistant`/`user`, y un
  `result` final con `total_cost_usd`, `duration_ms`, `is_error`). Ideal para
  ejecuciones lanzadas desde la app: se captura la salida, se muestra en vivo y se
  puede parar con `SIGTERM`.
- **Continuar** una sesión: `--resume <sessionId>` (opcional `--fork-session`).
- **Agente**: `--agent <nombre>`; **modelo**: `--model`; **permisos**:
  `--permission-mode default|acceptEdits|plan|auto|bypassPermissions`.
- **Interactiva**: dentro de `tmux new-session -d` para que el usuario pueda
  hacer `tmux attach` desde su terminal; la app puede leer la pantalla con
  `tmux capture-pane -p`.

## 3. Decisiones de arquitectura

| Decisión | Motivo |
|----------|--------|
| **Node.js ≥ 20 sin dependencias** (sólo `node:*`) | Instalación instantánea, cero supply-chain, nada que auditar fuera del repo. |
| Servidor HTTP propio en `127.0.0.1` | Todo local; la UI es una SPA servida por el mismo proceso. |
| Persistencia en JSON en `~/.agentic/` con escritura atómica (tmp + rename) | Simple, inspeccionable, portable; volúmenes pequeños. |
| Frontend vanilla JS (ES modules) + CSS con tokens | Sin build step; CSP estricta posible (sin scripts inline). |
| `child_process.spawn` con array de argumentos (nunca `shell: true`) | Evita inyección de comandos. |
| Tests con `node:test` | Sin dependencias; se ejecutan con `npm test`. |

## 4. Modelo de amenazas (resumen, ver `SECURITY.md`)

Una app local que puede **ejecutar Claude Code con permisos** es un objetivo
interesante: cualquier web que visites podría intentar llamarla (CSRF, DNS
rebinding). Mitigaciones: bind a loopback, token de acceso, validación de `Host`
y `Origin`, cookie `HttpOnly; SameSite=Strict`, sólo JSON en mutaciones, CSP,
validación estricta de entradas, límites de tamaño y de concurrencia.
