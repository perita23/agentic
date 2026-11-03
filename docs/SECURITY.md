# Seguridad

Agentic puede **lanzar Claude Code con permisos sobre tus proyectos**, leer tus transcripciones
y escribir subagentes. Aunque sólo escucha en local, cualquier web que visites puede intentar
hablar con `127.0.0.1`. Este documento resume el modelo de amenazas y las defensas.

## Amenazas consideradas

| Amenaza | Defensa | Test |
|---------|---------|------|
| Otra máquina de la red accede al servidor | Bind a `127.0.0.1`; el launcher se niega a otra interfaz sin `AGENTIC_ALLOW_REMOTE=1` | — |
| Otro usuario/proceso local o web maliciosa sin credenciales | Token aleatorio de 256 bits (`~/.agentic/token`, 0600) que sólo abre una **sesión de servidor**; la cookie (`HttpOnly; SameSite=Strict`) lleva un id aleatorio de 256 bits del que sólo se guarda el SHA-256; caducidad 30 días / 7 de inactividad; comparación en tiempo constante | `security.test.ts`, `auth.test.ts`, smoke |
| Robo del token (historial de terminal o navegador) | **Touch ID / passkeys** (WebAuthn, plataforma, verificación de usuario obligatoria) y opción **exigir Touch ID**, que anula el token (URL y Bearer) y cierra las sesiones abiertas con él; sólo activable desde una sesión iniciada con passkey (no puedes bloquearte); recuperación local `npm run reset-auth` | `auth.test.ts`, smoke (autenticador virtual) |
| Fuerza bruta en el login | Límite de 10 fallos/minuto en `/auth` y en el login con passkey; retos WebAuthn de un solo uso (5 min) en cookie HttpOnly | `auth.test.ts` |
| Robo de cookie | Revocación de sesiones desde Ajustes, «cerrar las demás», logout real (borra la sesión del servidor) | `auth.test.ts`, smoke |
| Permisos laxos en los datos | Al arrancar se corrigen `~/.agentic` y sus ficheros a 0700/0600 (sólo los del propio usuario, sin seguir symlinks) | `auth.test.ts` |
| Trazabilidad | Registro de auditoría en `~/.agentic/audit.log` (0600, rotación a 5 MB): logins, fallos, passkeys, sesiones y toda mutación de la API (método + ruta, nunca cuerpos ni secretos) | `auth.test.ts`, smoke |
| Redirección abierta tras el login | `next` sólo acepta rutas internas (`/…`, no `//` ni `/\`) | — |
| **DNS rebinding** (dominio atacante que resuelve a 127.0.0.1) | Allow-list del header `Host` (sólo `127.0.0.1`, `localhost`, `[::1]`) en `proxy.ts`, en `/auth` y en cada Route Handler | ídem |
| **CSRF** desde otra web | Mutaciones exigen `Content-Type: application/json` (no enviable por formularios sin preflight CORS), `Origin` propio si existe y `Sec-Fetch-Site` same-origin; además cookie `SameSite=Strict` | ídem |
| **XSS** con datos de transcripciones/tareas | React escapa todo el texto; nunca se usa `dangerouslySetInnerHTML`; CSP con nonce por petición y `strict-dynamic`, sin `unsafe-eval` en producción, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` | smoke (payload `<img onerror>`) |
| Clickjacking | `X-Frame-Options: DENY` + `frame-ancestors 'none'` | smoke |
| **Inyección de comandos** al lanzar Claude | `spawn` con array de argumentos y `shell: false`; tmux recibe el comando como argv (sin shell); el prompt va tras `--` para que no pueda convertirse en flag; `model`, `agent`, `permissionMode` y `resumeSessionId` validados con regex/enum | `runs.test.ts` (`$(touch …)`, `--dangerously-skip-permissions` como prompt) |
| **Path traversal** | IDs de sesión/ejecución deben ser UUID; nombres de agente `^[a-z0-9][a-z0-9-]{0,63}$` + comprobación de directorio; colecciones del store con regex; agentes de proyecto e info de proyecto sólo para proyectos conocidos; no se siguen symlinks en carpetas de agentes | `agents.test.ts`, `sessions.test.ts`, `api.test.ts` |
| **Repositorios maliciosos** (config git que ejecuta código) | Todo git pasa por `src/lib/server/git.ts`: `core.fsmonitor=false`, `core.hooksPath=/dev/null`, `core.pager=cat`, `core.attributesFile=/dev/null`, `GIT_ATTR_SOURCE`=árbol vacío (ignora `.gitattributes`), **filtros clean/smudge/process de la config anulados** (también los de `.git/info/attributes`), `diff` siempre con `--no-ext-diff --no-textconv`; sin prompts y con timeout. Verificado que un `git diff` normal sí ejecuta el filtro malicioso y el endurecido no | `projects.test.ts`, `run-diff.test.ts` |
| Línea base del diff por ejecución | Se captura sin modificar el repo (sin `stash`, sin tocar el índice): HEAD + ficheros modificados/no rastreados previos; el diff marca los cambios preexistentes | `run-diff.test.ts` |
| Inyección en front-matter de agentes | Valores de una sola línea, entrecomillados en JSON cuando hace falta | `agents.test.ts` |
| Mass assignment | Esquemas zod `.strict()` en actualizaciones; `id`, `createdAt`, … no se pueden sobrescribir | `tasks.test.ts` |
| DoS / agotamiento de recursos | Cuerpo de petición ≤ 1 MB; logs por ejecución con tope; máximo de ejecuciones simultáneas; historial acotado (500 runs, 5000 tareas); lectura de transcripciones en streaming; ficheros leídos con tamaño máximo | `runs.test.ts`, `api.test.ts` |
| Ejecución autónoma descontrolada (cola) | Una ejecución cada vez, límite de tareas por tanda (≤50), presupuesto por tarea opcional, parada en el primer fallo por defecto, nunca se reanuda sola tras reiniciar; el modo `bypassPermissions` no se ofrece para la cola | `queue.test.ts` |
| **Credenciales de integraciones** (Slack, GitHub, Bitbucket, Jira) | Sólo en `~/.agentic/integrations.json` (0600); la API devuelve pistas enmascaradas, nunca el secreto; editar sin reescribir el secreto lo conserva | `integrations-slack.test.ts`, smoke |
| **SSRF / fuga de tokens** en llamadas salientes | https obligatorio, sin credenciales en URL, las rutas no pueden salir del origen configurado, redirecciones sólo del mismo origen (máx. 3, nunca en escrituras), timeout 10 s, respuesta ≤ 5 MB | `integrations-slack.test.ts` |
| Inyección en mensajes de Slack | El texto de usuario que Agentic publica escapa `& < >` (sin `@channel` ni enlaces forjados); IDs de canal y `ts` validados por regex; los mensajes recibidos se pintan como texto | `integrations-slack.test.ts` |
| Acciones sobre pull requests | Sólo repos de proyectos conocidos; owner/repo/número validados; merge con el SHA de cabeza esperado (GitHub lo comprueba; en Bitbucket se verifica antes) para no mergear commits no revisados; confirmación en la UI; enlaces externos sólo `http(s)` | `integrations-prs.test.ts`, smoke |
| Acciones sobre Jira | Claves validadas (`PROY-123`), JQL acotada a 2000 caracteres y enviada en el cuerpo (no en la URL), transiciones verificadas contra las disponibles antes de aplicarlas, comentarios convertidos a ADF como texto (sin marcado ejecutable) | `integrations-jira.test.ts`, smoke |
| App de escritorio (Electron) | `contextIsolation`, `sandbox`, sin `nodeIntegration`; el preload sólo expone `version()` y `checkForUpdates()` y el proceso principal sólo responde a frames del origen local; la ventana no puede navegar fuera (los enlaces se abren en el navegador, sólo `http(s)`); permisos denegados salvo notificaciones; servidor sólo en `127.0.0.1` | revisión + CI `Desktop` |
| Actualizaciones de la app | Sólo desde la Release de este repositorio por https (hosts de GitHub), zip verificado con SHA-512 de `latest-mac.yml` en tiempo constante, `codesign --verify --deep --strict` del bundle antes de instalar, YAML con esquema FAILSAFE, nombres de fichero validados; el reemplazo se hace con un script que recibe las rutas como argumentos (sin interpolar) y restaura la versión anterior si falla | `desktop.test.ts` |
| Corrupción de datos | Escrituras atómicas (tmp + fsync + rename); ficheros corruptos se respaldan y no rompen la app | `store.test.ts` |
| Fugas de información en errores | Errores 500 genéricos; detalles sólo en el log del servidor | — |

## Recomendaciones de uso

- No ejecutes Agentic como root.
- El modo de permisos `bypassPermissions` permite a Claude ejecutar cualquier herramienta: úsalo sólo en entornos aislados.
- Si crees que el token se ha filtrado: `npm run rotate-token` y reinicia.
- El enlace con `?token=` queda en el historial del navegador local; la cookie dura un año.

## Dependencias

`npm audit --omit=dev` → 0 vulnerabilidades en dependencias de producción.
Las alertas moderadas restantes (`minimatch`) están sólo en la cadena de ESLint (herramienta de desarrollo, no se ejecuta en la app).

## Instalación de herramientas

`POST /api/system/install` sólo acepta `{"tool": "tmux" | "claude"}` y ejecuta una receta fija con el gestor detectado (`brew install tmux`, `brew install --cask claude-code` o `npm install -g @anthropic-ai/claude-code`): ningún dato del usuario llega a la línea de comandos, sin shell, stdin cerrado (`NONINTERACTIVE=1`), una instalación a la vez, 15 minutos como máximo y salida limitada a 64 KB. Requiere sesión como el resto de la API y queda en el registro de auditoría.

## Integraciones con OAuth

- GitHub usa el *device flow* (sin secreto ni redirección) o el token del CLI `gh`, validado contra la API antes de guardarlo.
- Jira (Atlassian 3LO) y Bitbucket usan *authorization code* con redirección a `http://localhost:PUERTO/api/integrations/oauth/callback`. Esa ruta no exige sesión (la cookie es `SameSite=Strict` y no viaja en la redirección), pero sólo acepta un `state` aleatorio de 256 bits creado por un «Conectar» autenticado, de un solo uso y con 10 minutos de validez. El código se canjea en el servidor.
- Client ID/Secret de las apps OAuth, access y refresh tokens se guardan en `~/.agentic` (0600) y la API nunca los devuelve. Los refresh tokens rotan y se renuevan de uno en uno.

## Bloqueo de la app de Mac

- Contraseña elegida en el primer arranque, guardada sólo como hash scrypt con sal aleatoria en `~/.agentic/desktop-lock.json` (0600); comparación en tiempo constante y espera exponencial tras 5 fallos.
- Touch ID sólo se activa tras verificar la huella; cambiar la contraseña exige la actual. Ambas acciones sólo las acepta el proceso principal desde páginas del servidor local.

## Identidad de la app de Mac sin Developer ID

Sin certificado de Apple, la app se firma ad-hoc y su requisito designado sería el hash exacto del código, distinto en cada versión, con lo que macOS (TCC) olvidaba los permisos de carpetas en cada actualización. El bundle se firma con el requisito explícito `designated => identifier "dev.agentic.console"`, así los permisos se mantienen. Contrapartida: otro binario ad-hoc con el mismo identificador cumpliría ese requisito; con un Developer ID (`CSC_LINK`) el requisito vuelve a incluir el certificado.

## Estándares de referencia y estado (v0.16)

Agentic es una app local (servidor en `127.0.0.1` + ventana Electron) que controla Claude Code y guarda credenciales de terceros, así que se revisa contra:

- **OWASP ASVS 5.0** (nivel 1 completo y lo aplicable de nivel 2) y **OWASP Top 10 (2021)** para la parte web.
- **Lista de seguridad oficial de Electron** (incluidos los *fuses*).
- **Cadena de suministro**: dependencias auditadas, actualizaciones firmadas, sumas SHA-256 y SBOM.

### OWASP Top 10 / ASVS

| Área | Medidas |
| --- | --- |
| A01 Control de acceso | Sesión obligatoria en cada página y API (proxy + cada ruta); Host allow-list contra DNS rebinding; rutas públicas mínimas (login, retorno OAuth con `state` de un uso). |
| A02 Criptografía | Sesiones de 256 bits (sólo se guarda el SHA-256); contraseña de la app con scrypt; **credenciales de integraciones y apps OAuth cifradas en disco (AES-256-GCM) con clave en el Llavero de macOS**; comparaciones en tiempo constante. |
| A03 Inyección | Validación con zod en servidor; procesos sin shell y prompt tras `--`; git con filtros/hooks/fsmonitor neutralizados; React sin HTML crudo; Markdown de las notas renderizado como texto. |
| A04 Diseño inseguro | Cola sin `bypassPermissions`; instalador sólo con recetas fijas; límites de tamaño, tiempo y concurrencia. |
| A05 Configuración | CSP con nonce y sin `unsafe-eval`; `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP `same-origin`, `Permissions-Policy`; respuestas de API `no-store`; ficheros de `~/.agentic` 0600 y carpeta 0700. |
| A06 Componentes vulnerables | `npm audit` (web y app de escritorio) en cada CI; Dependabot semanal para npm y Actions. |
| A07 Autenticación | Touch ID/passkeys (WebAuthn con verificación de usuario), contraseña de la app ≥ 8 con espera exponencial, límites de intentos, caducidad de sesiones (30 días / 7 sin uso), revocación. |
| A08 Integridad | Actualizaciones con SHA-512 + firma del bundle y, si se configura, **firma Ed25519 del manifiesto**; `SHA256SUMS.txt` y SBOM CycloneDX en cada release. |
| A09 Registro | Auditoría de inicios de sesión y de toda acción que cambia algo (método y ruta, nunca contenidos ni secretos), rotada. |
| A10 SSRF | Cliente de integraciones sólo https, origen fijo, redirecciones sólo al mismo origen, límite de tamaño y tiempo. |
| Fugas de datos | Secretos nunca devueltos al navegador; URLs de remotos sin credenciales; las notificaciones del sistema no incluyen el prompt; sin telemetría. |

### Lista de seguridad de Electron

| Recomendación | Estado |
| --- | --- |
| Sólo contenido local (servidor propio en localhost) | ✅ |
| `contextIsolation`, `sandbox`, sin `nodeIntegration`, `webSecurity` | ✅ |
| CSP | ✅ (servidor y ventana de desbloqueo) |
| Sin `allowRunningInsecureContent` ni funciones experimentales | ✅ |
| Gestor de permisos (sólo notificaciones, portapapeles y micrófono para el dictado, sólo el origen propio) | ✅ |
| Navegación y ventanas nuevas bloqueadas; enlaces externos sólo http(s) al navegador | ✅ |
| `<webview>` bloqueado en cualquier `webContents` | ✅ |
| IPC: se valida el remitente de cada mensaje; preload mínimo con `contextBridge` | ✅ |
| DevTools desactivadas en las versiones publicadas | ✅ |
| **Fuses**: `RunAsNode`, `NODE_OPTIONS` e `--inspect` desactivados; código sólo desde el asar con integridad verificada; cookies cifradas | ✅ (el servidor corre en un `utilityProcess`) |
| Electron actualizado | ✅ (Dependabot) |

### Pendiente por decisión del propietario

- **Firmar las actualizaciones con Ed25519**: ejecuta `node scripts/update-keygen.mjs` en tu Mac y guarda la clave privada como secret `AGENTIC_UPDATE_PRIVATE_KEY` y la pública como variable `AGENTIC_UPDATE_PUBLIC_KEY`. A partir de ahí la app sólo instala actualizaciones firmadas.
- **Developer ID de Apple + notarización** (de pago): sustituiría la firma ad-hoc y quitaría el aviso de Gatekeeper.
