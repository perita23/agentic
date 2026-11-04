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

## Fase 5 — Roadmap autónomo (desde v0.17)

Criterio: lo que más tiempo ahorra a quien trabaja a diario con Claude Code, sin salir de lo local.

| Versión | Feature | Por qué |
| --- | --- | --- |
| v0.17 | **Chat** con Claude sin proyecto, con historial (buscar, fijar, borrar) | Preguntas rápidas sin abrir un terminal ni elegir carpeta. |
| v0.18 | **Login nuevo** a pantalla completa + distintivo «Diseñada según OWASP ASVS / Electron» | Primera impresión y confianza. |
| v0.19 | **Servidores MCP**: ver, añadir, activar y quitar los MCP de Claude Code (usuario y proyecto) | Hoy exige editar JSON a mano. |
| v0.20 | **Permisos de Claude Code**: editor visual de `settings.json` (allow/deny, modo por defecto) | Menos interrupciones y menos riesgo. |
| v0.21 | **Tareas en worktrees aislados**: cada ejecución de la cola en su propio `git worktree` y rama | Paralelizar sin pisarse; revisar y mergear como una PR. |
| v0.22 | **Programar tareas** (una vez o recurrentes) | Rutinas nocturnas: dependencias, informes, limpiezas. |
| v0.23 | **Presupuesto y alertas** de gasto/tokens por día y proyecto | Control de costes. |
| v0.24 | **Copia de seguridad, exportar y borrar** los datos de Agentic | Portabilidad y control de los datos. |

## Ideas anotadas (sin implementar)

### La bola líquida como indicador de estado de la IA (hecho en v0.26)
Idea del usuario (2026-11-04): que la bola líquida («morphism») de la pantalla de inicio sea también el *loader* de cuando la IA está pensando, y que cambie de animación según lo que esté haciendo en ese momento.

- **Un solo componente compartido** (`<LiquidOrb state=… />`) con la misma estética que la pantalla de bloqueo, usado en:
  - Chat (respuesta en curso).
  - Ejecuciones headless (página de la ejecución, en vivo).
  - Cola de tareas y programadas (ejecución activa).
  - Sesiones activas y, en pequeño, en la barra lateral como estado global («Claude está trabajando»).
- **Estados** (cada uno con su propia animación: ritmo, tamaño, forma y color):
  - Inactivo: respira despacio.
  - Pensando: pulsa y se deforma.
  - Escribiendo la respuesta.
  - Herramienta en curso: leyendo, editando ficheros, ejecutando un comando, buscando en la web o usando MCP.
  - Esperando permiso o una respuesta del usuario.
  - Completado y error.
- **De dónde sale el estado**: de los eventos `stream-json` que ya se guardan en el log de cada ejecución (`system/init`, bloques `text` y `thinking`, `tool_use` con el nombre de la herramienta, `tool_result`, `result` con `is_error`). Hace falta una función pura `estadoDesdeEventos(eventos)` y probarla, tanto para el log en vivo (SSE) como para ejecuciones ya terminadas.
- **A tener en cuenta**:
  - Respetar `prefers-reduced-motion` (versión estática con cambio de color).
  - Coste de rendimiento: el filtro «goo» de SVG es costoso a pantalla grande; para tamaños pequeños probar canvas o WebGL, o menos esferas.
  - Accesibilidad: el estado también como texto (`aria-live`), nunca solo con animación.
- **Cambios**: front (componente + integración en chat, runs, cola, sesiones y barra lateral) y un pequeño endpoint o campo derivado con el estado actual de cada ejecución.
