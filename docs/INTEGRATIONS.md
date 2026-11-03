# Integraciones

Objetivo: trabajar con **Slack, GitHub, Bitbucket y Jira sin salir de Agentic**: leer y responder mensajes,
revisar y mergear pull requests, y ver, comentar y mover incidencias, enlazándolo todo con tus proyectos,
tareas y ejecuciones de Claude Code.

## Principios

1. **Local primero.** Las credenciales viven sólo en `~/.agentic/integrations.json` (permisos `0600`). El
   navegador nunca recibe un secreto: la API devuelve una pista enmascarada (`xoxb…1234`). Para editar una
   integración sin tocar el secreto, se deja el campo vacío.
2. **Todo pasa por el servidor local** (`src/lib/server/integrations/http.ts`):
   - sólo `https` (http únicamente con `AGENTIC_ALLOW_INSECURE_INTEGRATIONS=1`, para tests);
   - nunca credenciales en la URL; las peticiones no pueden salir del origen configurado;
   - redirecciones sólo dentro del mismo origen, máximo 3, y nunca en peticiones de escritura;
   - timeout de 10 s y respuesta máxima de 5 MB;
   - los fallos del proveedor se devuelven como `502` con un mensaje legible (sin cabeceras ni tokens).
3. **Acciones con consecuencias** (merge, cerrar, transicionar) exigen confirmación en la UI y validan el
   estado esperado en el servidor (p. ej. el SHA de la cabeza de la PR).
4. **Alcance acotado:** las operaciones sobre repositorios sólo se permiten en repos asociados a un proyecto
   conocido por Agentic (detectados desde `git remote get-url origin`).
5. Texto de terceros (mensajes, descripciones, comentarios) se pinta **siempre como texto**, nunca como HTML;
   el texto que Agentic envía a Slack escapa `& < >` para que nadie pueda inyectar `@channel` o enlaces.

## Hoja de ruta

| Versión | Alcance | Estado |
|---------|---------|--------|
| v0.5.0 | Framework + página Integraciones (conectar / probar / desconectar los 4 proveedores) + **Slack**: canales, historial, hilos, enviar y responder, avisos de ejecuciones y cola | ✅ |
| v0.6.0 | **Pull requests GitHub + Bitbucket**: bandeja unificada, detalle (descripción, conversación, reviews, checks, diff), comentar, aprobar / pedir cambios, merge con SHA esperado, cerrar, «Revisar con Claude» | ✅ |
| v0.7.0 | **Jira**: incidencias por JQL, detalle y comentarios, comentar, transiciones de estado, importar como tarea (enlazada) | ⏳ |
| backlog | Confluence (páginas como contexto del prompt), webhooks entrantes en tiempo real | ⏳ |

## Configuración por proveedor

| Proveedor | Credencial | Permisos mínimos |
|-----------|-----------|------------------|
| Slack | Bot token `xoxb-…` (o user token `xoxp-…`) | `channels:read`, `channels:history`, `groups:read`, `groups:history`, `chat:write`, `users:read` (opcional, para nombres) |
| GitHub | Token fine-grained (o clásico) | Pull requests R/W, Issues R/W, Contents R/W (merge), Checks R, Commit statuses R |
| Bitbucket | API token de Atlassian (email + token) o access token del repo/workspace | Repositorios lectura, Pull requests lectura/escritura |
| Jira Cloud | Email + API token | Los del usuario |
