# Seguridad

Agentic puede **lanzar Claude Code con permisos sobre tus proyectos**, leer tus transcripciones
y escribir subagentes. Aunque sólo escucha en local, cualquier web que visites puede intentar
hablar con `127.0.0.1`. Este documento resume el modelo de amenazas y las defensas.

## Amenazas consideradas

| Amenaza | Defensa | Test |
|---------|---------|------|
| Otra máquina de la red accede al servidor | Bind a `127.0.0.1`; el launcher se niega a otra interfaz sin `AGENTIC_ALLOW_REMOTE=1` | — |
| Otro usuario/proceso local o web maliciosa sin credenciales | Token aleatorio de 256 bits (`~/.agentic/token`, modo 0600); cookie `HttpOnly; SameSite=Strict`; comparación en tiempo constante | `security.test.ts`, `api.test.ts`, smoke |
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
