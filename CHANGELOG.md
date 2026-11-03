# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).
Cada versión se etiqueta y publica automáticamente como GitHub Release cuando el CI pasa en `main`.

## [0.9.0] - 2026-11-03

### Añadido
- **Inicio de sesión con Touch ID** (passkeys WebAuthn, autenticador de plataforma con verificación de usuario obligatoria). Página `/login` con «Entrar con Touch ID».
- **Exigir Touch ID**: con la opción activa, el enlace con token y el token Bearer dejan de dar acceso y se cierran las sesiones abiertas con token. Recuperación local con `npm run reset-auth`.
- **Sesiones** gestionables en Ajustes: listar, revocar, «cerrar las demás» y cerrar sesión.
- **Registro de auditoría** (`~/.agentic/audit.log`, visible en Ajustes): inicios de sesión, intentos fallidos, cambios de passkeys y sesiones, y toda acción que modifica algo (método y ruta, nunca contenidos ni secretos).

### Seguridad
- La cookie ya no contiene el token maestro: sesiones de servidor con id aleatorio de 256 bits del que sólo se guarda el SHA-256; caducan a los 30 días o tras 7 sin uso. La cookie antigua deja de valer.
- Límite de intentos fallidos en `/auth` y en el login con passkey.
- Retos WebAuthn de un solo uso con caducidad de 5 minutos, ligados a cookie HttpOnly.
- Al arrancar se corrigen permisos laxos en `~/.agentic` (directorios 0700, ficheros 0600).
- La URL de acceso pasa a `http://localhost:PUERTO` (WebAuthn no admite IPs).

## [0.8.0] - 2026-11-03

### Añadido
- **Log de ejecuciones en tiempo real (SSE)**: `GET /api/runs/:id/stream` envía cada línea en cuanto Claude la escribe, con indicador «en vivo». Cada evento lleva su offset como `id`, así que una reconexión continúa exactamente donde se quedó sin duplicar líneas; heartbeat cada 15 s y cierre limpio al terminar.

### Cambiado
- La página de una ejecución usa SSE en lugar de sondear cada segundo; agrupa las actualizaciones por frame y vuelve a polling automáticamente si el navegador no puede mantener la conexión.

## [0.7.0] - 2026-11-03

### Añadido
- **Jira** (`/jira`): incidencias por JQL con búsquedas rápidas (asignadas a mí, creadas por mí, actualizadas en 7 días) y la JQL por defecto configurable.
- **Detalle de incidencia**: descripción y comentarios (ADF convertido a texto), etiquetas, asignado y prioridad.
- **Acciones**: comentar, **cambiar de estado** (sólo transiciones que Jira ofrece en ese momento), **importar como tarea** enlazada (una sola vez, prioridad mapeada) y **«Resolver con Claude»** en el proyecto elegido.

## [0.6.0] - 2026-11-03

### Añadido
- **Pull requests de GitHub y Bitbucket** (`/pulls`): bandeja unificada con las PRs abiertas de los repositorios de tus proyectos (detectados por `git remote`), filtros por proveedor y texto.
- **Detalle de PR**: descripción, conversación (comentarios y reviews en orden), archivos con diff y checks.
- **Acciones**: comentar, aprobar, pedir cambios, **mergear** (squash / merge / rebase o fast-forward) y cerrar o rechazar, con confirmación.
- **«Revisar con Claude»**: lanza una ejecución de Claude Code en el proyecto con un prompt de review de la PR.

### Seguridad
- El merge va anclado al SHA que estabas viendo: si la PR recibe commits nuevos, se rechaza en lugar de mergear código no revisado.
- Sólo se opera sobre repositorios asociados a proyectos conocidos; owner/repo/número validados.
- Los enlaces externos sólo se renderizan si son `http(s)`.

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
