# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).
Cada versión se etiqueta y publica automáticamente como GitHub Release cuando el CI pasa en `main`.

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
