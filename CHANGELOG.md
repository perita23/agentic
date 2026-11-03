# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).
Cada versión se etiqueta y publica automáticamente como GitHub Release cuando el CI pasa en `main`.

## [0.5.0] - 2026-11-03

### Añadido
- **Integraciones** (`/integrations`): conectar, probar y desconectar Slack, GitHub, Bitbucket y Jira. Las credenciales se guardan sólo en `~/.agentic/integrations.json` (0600) y nunca llegan al navegador.
- **Mensajes de Slack** (`/messages`): canales, historial, hilos, enviar mensajes y responder en hilo desde Agentic; menciones resueltas a nombres.
- **Avisos en Slack** al terminar una ejecución o la cola (a un canal con el bot o por incoming webhook), con opción «sólo fallos».
- Documento `docs/INTEGRATIONS.md` con la hoja de ruta (PRs de GitHub/Bitbucket en v0.6.0, Jira en v0.7.0).

### Seguridad
- Cliente HTTP de integraciones endurecido: sólo https, sin credenciales en URL, sin salir del origen configurado, redirecciones sólo del mismo origen, timeout y tope de tamaño; texto enviado a Slack escapado para evitar `@channel` o enlaces inyectados.

## [0.4.0] - 2026-11-03

### Corregido
- Los botones «Detener» ejecución y «Parar» cola no funcionaban: el cliente enviaba los POST sin cuerpo JSON y el servidor (protección CSRF) los rechazaba con 415. Ahora todas las mutaciones envían JSON; test E2E que pulsa «Detener».

### Añadido
- **Cola de tareas autónoma**: botón «Ejecutar cola» en el tablero. Ejecuta las tareas «To do» con proyecto, una a una y por prioridad; las que terminan bien pasan a Revisión. Previsualiza qué se ejecutará, límite de tareas por tanda, presupuesto opcional por tarea, modo de permisos y «parar en el primer fallo». Banner de progreso con «Parar tras la actual». Nunca se reanuda sola tras reiniciar.
- **Búsqueda de texto completo** dentro de las conversaciones (Sesiones → «En el contenido»): prompts y respuestas de Claude, de lo más reciente a lo más antiguo, con fragmentos resaltados y presupuesto de tiempo.

## [0.3.0] - 2026-11-03

### Añadido
- **Analítica de uso** (`/analytics`): tokens por día (gráfico con desglose al pasar el ratón y vista de tabla), por proyecto, por modelo y herramientas más usadas, en ventanas de 7/30/90 días y filtrable por proyecto. Se calcula a partir de las transcripciones locales con caché incremental por fichero; el coste mostrado es sólo el real reportado por las ejecuciones de Agentic (no se estiman precios).

## [0.2.0] - 2026-11-03

### Añadido
- **Diff git por ejecución**: pestaña «Cambios» en cada ejecución con los commits, ficheros modificados (+/−), ficheros nuevos y el patch de lo que hizo Claude. Los cambios que ya existían antes de lanzar se marcan como «previo».
- **Notificaciones** al terminar una ejecución: toast con acceso directo y notificación de escritorio opcional (Ajustes).
- Versión de la app visible en Ajustes y en la barra lateral.
- Releases automáticas (`.github/workflows/release.yml`) y este changelog.

### Seguridad
- Todo git pasa por un helper endurecido que neutraliza filtros clean/smudge/process, textconv, diff externos, fsmonitor, hooks y pagers definidos por el repositorio (incluido `.git/info/attributes`). Antes, `git status` en la ficha de proyecto podía ejecutar el filtro de un repo malicioso.

## [0.1.0] - 2026-11-03

### Añadido
- Consola web local (Next.js 16, Tailwind 4, shadcn/ui, Motion) con tema oscuro estilo Cursor.
- Sesiones de Claude Code con estado en vivo y visor de transcripciones.
- Ejecuciones headless (log en vivo, coste, parar) e interactivas en tmux.
- Gestor de subagentes de usuario y de proyecto.
- Kanban de tareas con drag & drop, plantillas con variables y «Ejecutar con Claude».
- Proyectos con ficha git / CLAUDE.md / scripts.
- Paleta de comandos `Ctrl+K`.
- CI: typecheck, lint, tests, build, smoke E2E en Chromium y `npm audit`.

### Seguridad
- Bind a loopback, token + cookie `HttpOnly; SameSite=Strict`, allow-list de `Host`, anti-CSRF, CSP con nonce, procesos sin shell, límites de tamaño y concurrencia.

### Corregido
- Mover una tarea en el Kanban ya no borra su descripción, etiquetas, checklist y prompt.
