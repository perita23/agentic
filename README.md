# ◆ Agentic Console

[![CI](https://github.com/perita23/agentic/actions/workflows/ci.yml/badge.svg)](https://github.com/perita23/agentic/actions/workflows/ci.yml)

Consola **web local** para gestionar Claude Code en tu máquina, con estética oscura estilo Cursor.

- **Sesiones** — todas las conversaciones de `~/.claude` (con búsqueda de texto completo), estado en vivo (trabajando / esperando), visor de transcripciones con tokens y herramientas, comando para reanudar.
- **Ejecuciones** — lanza Claude Code *headless* (log en vivo, coste, parar) o *interactivo en tmux* (ver pantalla, enviar mensajes, `tmux attach`). Continúa cualquier sesión con `--resume`. Pestaña **Cambios** con el diff git de lo que modificó Claude (commits, ficheros, ficheros nuevos) y **notificaciones** de escritorio al terminar.
- **Agentes** — crea/edita subagentes de usuario (`~/.claude/agents`) y de proyecto (`.claude/agents`), y lánzalos.
- **Tareas** — tablero Kanban con drag & drop, prioridades, etiquetas, checklist, fecha límite y botón *Ejecutar con Claude* (la tarea pasa a *En curso* y luego a *Revisión*).
- **Cola autónoma** — ejecuta las tareas «To do» una a una por prioridad, con límite por tanda, presupuesto y parada ante fallos.
- **Plantillas** — plantillas con variables `{{var}}` para crear tareas y prompts (bug, feature, review, tests, refactor, auditoría…).
- **Proyectos** — detectados desde tus sesiones o registrados a mano; ficha con git (rama, commits, cambios), `CLAUDE.md`, scripts, stack, sesiones, tareas y agentes.
- **Analítica** — tokens por día, proyecto, modelo y herramienta a partir de tus transcripciones locales.
- **Pull requests** — bandeja de GitHub y Bitbucket: diff, checks, reviews, comentar, aprobar, mergear y cerrar, o «Revisar con Claude».
- **Jira** — incidencias por JQL: comentar, cambiar de estado, importar como tarea o «Resolver con Claude».
- **Integraciones** — Slack (leer y responder canales e hilos, avisos), y conexión con GitHub, Bitbucket y Jira (ver [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md)).
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

La terminal muestra un enlace del tipo `http://localhost:4317/auth?token=…`. Ábrelo una vez y quedará abierta una sesión en ese navegador.

**Touch ID:** en Ajustes → «Añadir Touch ID» registra tu huella; a partir de ahí puedes entrar en `http://localhost:4317/login` con Touch ID y, si quieres, activar **«Exigir Touch ID»** para que el enlace con token deje de servir. Si pierdes el acceso: `npm run reset-auth`.

Modo desarrollo (recarga en caliente):

```bash
npm run dev
```

¿Perdiste el enlace? `npm run url`. Sesiones y passkeys se gestionan en Ajustes → Seguridad.

### App para macOS

Descarga [`Agentic-arm64.dmg`](https://github.com/perita23/agentic-releases/releases/latest/download/Agentic-arm64.dmg) (Apple Silicon) o [`Agentic-x64.dmg`](https://github.com/perita23/agentic-releases/releases/latest/download/Agentic-x64.dmg) (Intel) desde la [página de descarga](https://perita23.github.io/agentic-releases/) o la [última Release](https://github.com/perita23/agentic-releases/releases/latest), arrástrala a Aplicaciones y ábrela. Pide Touch ID al abrir y se actualiza sola: comprueba si hay versión nueva cada vez que entras, o desde el menú «Buscar actualizaciones…» / Ajustes.

> Mientras no esté firmada con un Developer ID de Apple, la primera vez macOS pedirá confirmación: clic derecho → **Abrir** (o `xattr -dr com.apple.quarantine /Applications/Agentic.app`). Las actualizaciones posteriores ya no lo piden.

Compilarla en local (en un Mac):

```bash
npm run desktop:dist
```

Para firmarla y notarizarla, define en el repositorio los secretos `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y `APPLE_TEAM_ID`.

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

(typecheck + lint + tests unitarios/integración), y el smoke test E2E en Chromium sobre la build de producción:

```bash
npm run build && npm run smoke
```

Ambos se ejecutan en GitHub Actions en cada PR y en cada push a `main` (`.github/workflows/ci.yml`), junto con `npm audit` de dependencias de producción; las capturas del smoke test quedan como artefacto.

## Documentación

- [`docs/RESEARCH.md`](docs/RESEARCH.md) — cómo guarda Claude Code sus datos y decisiones de arquitectura
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — fases del proyecto
- [`docs/KANBAN.md`](docs/KANBAN.md) — estado de las tareas
- [`docs/SECURITY.md`](docs/SECURITY.md) — modelo de amenazas y medidas de hardening

## Licencia

Agentic se distribuye bajo la [PolyForm Noncommercial License 1.0.0](LICENSE): **cualquiera puede descargarlo, usarlo, estudiarlo y modificarlo gratis para fines no comerciales** (uso personal, aprendizaje, investigación, organizaciones sin ánimo de lucro, educativas o públicas), **pero no se puede vender ni usar con fines comerciales** (por ejemplo, revenderlo, ofrecerlo como servicio de pago o incluirlo en un producto comercial) sin permiso del autor. Si lo redistribuyes o lo modificas, debes conservar el aviso de copyright y el texto de la licencia.

Es una licencia de código disponible, no «open source» en el sentido estricto de la OSI, porque esa definición no admite restringir el uso comercial. Las versiones publicadas hasta la 0.44 se distribuyeron bajo licencia MIT y quien las obtuvo así conserva esos derechos sobre esas copias. Para otro tipo de uso (por ejemplo, comercial), contacta con el autor.
