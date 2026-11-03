# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).
Cada versión se etiqueta y publica automáticamente como GitHub Release cuando el CI pasa en `main`.

## [0.14.2] - 2026-11-03

### Corregido
- App de Mac: los botones «Copiar» fallaban con «No se pudo copiar al portapapeles» porque la ventana denegaba el permiso de escribir en el portapapeles. Ahora se concede (sólo a las páginas de Agentic) y, si aun así fallase, se copia con el portapapeles nativo de macOS. macOS no pide permiso para copiar, así que no aparece ningún aviso.

## [0.14.1] - 2026-11-03

### Cambiado
- **Conectar integraciones, mucho más sencillo**: cada servicio tiene un único botón «Conectar» con dos pasos: un botón que abre la página exacta del servicio (en GitHub, con los permisos ya marcados) y un campo para pegar lo que copias. Agentic lo prueba al momento.
  - GitHub: si ya tienes sesión en el CLI `gh`, se conecta directamente sin pedir nada.
  - Jira: basta con escribir `tuempresa` o `tuempresa.atlassian.net`.
  - Si algo falla, un mensaje claro (token mal copiado, sin permisos, Jira no encontrado) y no queda nada a medias.
- OAuth y el resto de opciones quedan dentro de «Avanzado».

## [0.14.0] - 2026-11-03

### Añadido
- **Slack con login**: «Conectar con Slack» autoriza con tu cuenta y guarda un token de usuario, así ves y respondes tus canales y mensajes directos.
- **URL de vuelta común en HTTPS** (`https://perita23.github.io/agentic-releases/oauth/`) para todos los servicios y cualquier puerto: una página pública que sólo reenvía al Agentic de tu ordenador (`localhost`).
- **«Conectar con GitHub» sin configurar nada** cuando la build incluye el Client ID público de Agentic (device flow, sin secreto). Guía en `docs/OAUTH-SETUP.md`.

### Seguridad
- Ningún Client Secret se incluye en la app: Slack, Jira y Bitbucket guardan los suyos sólo en tu Mac.

## [0.13.0] - 2026-11-03

### Añadido
- **Mensajes directos de Slack**: tus conversaciones privadas y de grupo aparecen en «Mensajes directos» y puedes leerlas y responderlas. Hace falta el *User OAuth Token* (`xoxp-…`); con el token del bot (`xoxb-…`) Slack sólo deja ver lo que ve el bot, y la app te lo indica. La app de Slack creada con «Crear app de Slack» ya incluye los permisos de usuario necesarios.
- **Crear tarea desde un mensaje**: cualquier mensaje o respuesta se convierte en una tarea del backlog (etiqueta `slack`, con autor, conversación y texto).

### Cambiado
- **Mensajes rediseñado** con identidad propia de Agentic: bandeja con canales y mensajes directos, avatares con color propio por persona, separadores por día, mensajes seguidos agrupados, acciones al pasar el ratón y un compositor nuevo.
- Las apps de Slack antiguas sin permisos de mensajes directos siguen mostrando sus canales.

## [0.12.1] - 2026-11-03

### Corregido
- La app de Mac volvía a pedir permiso para leer carpetas (Documentos, Escritorio, Descargas…) al entrar en Agentes después de cada actualización: la firma ad-hoc identificaba la app por el hash exacto de su código, que cambia en cada versión, y macOS olvidaba el permiso. Ahora la app se identifica de forma estable por su bundle id (`dev.agentic.console`) y macOS recuerda los permisos entre actualizaciones. Tras instalar esta versión puede pedirlo **una última vez**.

### Añadido
- El aviso de macOS explica por qué Agentic necesita cada carpeta.
- Ajustes → App de escritorio → «Dar acceso total al disco»: abre directamente el panel de privacidad para conceder acceso de una vez a todas las carpetas.

## [0.12.0] - 2026-11-03

### Añadido
- **Integraciones con un clic**, sin pegar tokens:
  - GitHub: «Conectar con GitHub» (device flow: pegas un código en github.com) y «Usar mi sesión de gh» (reutiliza el login del CLI de GitHub).
  - Jira y Bitbucket: «Conectar» abre el login del servicio y vuelve a Agentic; el token se renueva solo.
  - Slack: «Crear app de Slack» crea la app ya configurada con los permisos necesarios.
  - Para GitHub, Jira y Bitbucket hay que registrar una vez una app OAuth; Agentic guía los pasos y muestra la URL de vuelta para copiar. Pegar un token sigue disponible.
- **Contraseña de la app de Mac**: la primera vez la ventana de inicio pide crear una contraseña; después se desbloquea con ella. **Touch ID se activa en Ajustes → App de escritorio** (pide la huella para activarlo), y desde ahí también se cambia la contraseña. Ventana de desbloqueo más grande.

### Seguridad
- La vuelta del login OAuth es pública pero sólo la acepta con un `state` aleatorio de 256 bits, de un solo uso y válido 10 minutos; los tokens se intercambian en el servidor, los refresh tokens y los secretos de las apps nunca se devuelven al navegador.
- La contraseña de la app se guarda sólo como hash scrypt (N=2^15) en `~/.agentic/desktop-lock.json` (0600); los intentos fallidos se frenan con espera exponencial.

## [0.11.1] - 2026-11-03

### Corregido
- El aviso «Cola finalizada» no aparecía si la cola terminaba antes de que la página la viera en marcha (tareas rápidas). Ahora se avisa de cada lote que termina después de abrir la página, usando su hora de fin.

## [0.11.0] - 2026-11-03

### Añadido
- **Instalar herramientas que faltan desde Ajustes**: si no está `tmux` o Claude Code aparece «Instalar con brew» (o npm para Claude Code si no hay Homebrew). Detecta Homebrew aunque no esté en el `PATH` (`/opt/homebrew`, `/usr/local`), muestra el comando y su salida en directo y refresca el estado al terminar. Sólo se ejecutan recetas fijas (`brew install tmux`, `brew install --cask claude-code`, `npm install -g @anthropic-ai/claude-code`), sin shell, una a la vez y con límite de 15 minutos.

### Cambiado
- **Nuevo logo**: «A» grotesca fina y rígida con el degradado de la web sobre fondo negro, en el icono de macOS, la barra lateral, el inicio de sesión, la ventana de desbloqueo, el favicon y la página de descarga.

## [0.10.2] - 2026-11-03

### Corregido
- App de macOS: los botones de la ventana (cerrar/minimizar/ampliar) ya no se solapan con el logo; las barras superiores sirven para arrastrar la ventana (y el hueco desaparece a pantalla completa).
- App de macOS: Touch ID se pide en una **ventana pequeña de desbloqueo** con «Reintentar» y «Salir» si falla, en lugar de cerrar la app; el servidor arranca mientras tanto.
- «Añadir Touch ID» se quedaba en «Esperando a Touch ID…» dentro de la app (WebAuthn no está disponible en la ventana de Electron). En la app, Touch ID es nativo y ya no se ofrece registrar passkeys allí; en el navegador, el registro se cancela solo a los 90 s.
- «Exigir Touch ID» se puede activar desde la app de Mac aunque no haya passkeys (la app verifica con Touch ID nativo al abrirse).

### Cambiado
- Ajustes reorganizado: seguridad (Touch ID y sesiones) arriba, después app de escritorio y notificaciones, sistema y datos, y la auditoría. La tarjeta de la app muestra versión, comprobación automática, última comprobación y verificación.

## [0.10.1] - 2026-11-03

### Añadido
- **Página de descarga** (`site/`, estática y sin dependencias) con botones para Apple Silicon e Intel, capturas, funciones e instrucciones. Se publica en GitHub Pages del repositorio público [`agentic-releases`](https://perita23.github.io/agentic-releases/).
- Las releases suben también `Agentic-arm64.dmg` y `Agentic-x64.dmg` con nombre fijo, así `releases/latest/download/...` siempre apunta a la última versión.
- Las releases se replican en el repositorio público `perita23/agentic-releases` (secret `RELEASES_TOKEN`), para descargar sin iniciar sesión en GitHub.

### Cambiado
- La app de macOS busca actualizaciones primero en `agentic-releases` **sin enviar ningún token**; sólo si no existe recurre al repositorio privado con el token de Integraciones.

## [0.10.0] - 2026-11-03

### Añadido
- **App para macOS** (Apple Silicon e Intel, macOS 13 o superior, incluido macOS 27): la misma interfaz dentro de una ventana nativa con barra de título integrada. Incluye su propio servidor (Next.js standalone ejecutado con el Node de Electron): no hace falta instalar Node.
- **Touch ID al abrir la app** (nativo) que abre una sesión «desktop»; funciona también con «Exigir Touch ID» activado.
- **Actualizaciones desde la propia app**, sin reinstalar: se comprueban cada vez que entras (al abrir, al volver a la app; como mucho cada 10 minutos), en el menú «Buscar actualizaciones…» y en Ajustes → App de escritorio. Descarga el zip de tu arquitectura con progreso en el Dock, **verifica su SHA-512** contra `latest-mac.yml`, valida la firma del bundle, sustituye la app y la reinicia. Funciona sin certificado de Apple y con repositorios privados (usa el token de GitHub de Integraciones).
- La app hereda el `PATH` de tu shell de login, así encuentra `claude`, `git` y `tmux` de Homebrew aunque se abra desde el Dock.
- CI: workflow `Desktop` que compila y **arranca** la `.app` en un runner macOS; la release adjunta `.dmg`, `.zip` y `latest-mac.yml`.

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
