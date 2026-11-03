# Roadmap — Agentic Console

Cada fase termina con tests en verde. El estado de cada tarea vive en [`KANBAN.md`](./KANBAN.md).

## Fase 0 · Investigación y diseño
- Estudiar el formato en disco de Claude Code (sesiones, procesos vivos, agentes).
- Estudiar la CLI (`-p`, `stream-json`, `--resume`, `--agent`, `--permission-mode`).
- Decidir stack y modelo de amenazas → `RESEARCH.md`.

## Fase 1 · Núcleo del servidor
- Servidor HTTP local con router, estáticos y manejo de errores uniforme.
- Almacén JSON atómico en `~/.agentic`.
- Capa de seguridad: token, cookie, `Host`/`Origin`, cabeceras, límites.
- CLI `agentic` (puerto, host, `--open`, rutas configurables).

## Fase 2 · Sesiones de Claude Code
- Indexar `~/.claude/projects/**.jsonl` con caché.
- Detectar sesiones activas vía `~/.claude/sessions/*.json` + PID vivo.
- Visor de transcripciones (texto, herramientas, tokens, modelo).
- Copiar comando de reanudación.

## Fase 3 · Lanzador de sesiones y agentes
- Ejecuciones headless con log NDJSON en vivo, parar, coste, `session_id`.
- Sesiones interactivas en `tmux` (captura de pantalla, matar).
- Continuar una sesión existente (`--resume`).
- CRUD de subagentes (`~/.claude/agents` y `.claude/agents` de cada proyecto).

## Fase 4 · Planificación de tareas
- Kanban (Backlog, To do, In progress, Review, Done) con drag & drop.
- Prioridad, etiquetas, checklist, proyecto asociado, prompt.
- Plantillas con variables `{{var}}` (+ plantillas por defecto).
- "Ejecutar con Claude": la tarea lanza una sesión y se enlaza a la ejecución.

## Fase 5 · Proyectos
- Descubrimiento automático (desde sesiones) + registro manual.
- Ficha: git (rama, último commit, cambios, remotos), CLAUDE.md, scripts de
  `package.json`, lenguajes, agentes, sesiones y tareas del proyecto.

## Fase 6 · UI
- Tema oscuro tipo GitHub/Cursor, barra lateral, dashboard, paleta de comandos (Ctrl+K).
- Estados vacíos, toasts de error, responsive.

## Fase 7 · Testing y hardening
- Tests unitarios (store, parsers, validación, plantillas).
- Tests de integración HTTP con un `~/.claude` y un `claude` falsos.
- Tests de seguridad (token, rebinding, CSRF, traversal, inyección, límites).
- Smoke test de la UI en navegador headless.
- Documentación `SECURITY.md` y `README.md`.

## Ideas futuras (fuera de alcance v1)
- Notificaciones de escritorio al terminar una ejecución.
- Programación de tareas (cron) y colas de ejecución.
- Comparar diffs git por ejecución.
- Empaquetado como app de escritorio (Tauri/Electron).
