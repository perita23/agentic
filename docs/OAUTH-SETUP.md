# Conectar integraciones con un login

URL de vuelta común para todos los servicios: **`https://perita23.github.io/agentic-releases/oauth/`** (página pública de GitHub Pages que sólo reenvía al Agentic de tu ordenador en `http://localhost`).

## GitHub: un botón, sin configurar nada en la app
Sólo necesita un Client ID público (device flow, sin secreto), que viaja dentro de la app:
1. https://github.com/settings/applications/new — nombre `Agentic`, Homepage `https://perita23.github.io/agentic-releases/`, Callback URL la de arriba.
2. Register application → marca **Enable Device Flow** → Update.
3. Secret del repositorio `AGENTIC_GITHUB_CLIENT_ID` = Client ID (Settings → Secrets and variables → Actions). La siguiente versión lo incluye.

## Slack, Jira y Bitbucket: login, con una configuración única en tu Mac
Estos servicios exigen un Client Secret, que **no se incluye en la app** (el `.dmg` es público). Al pulsar «Conectar con …» la primera vez, Agentic muestra los pasos para crear la app OAuth y pegar Client ID y Secret; se guardan sólo en tu Mac (`~/.agentic`, 0600). Después, conectar es un login.

- **Slack**: el diálogo abre la creación de la app desde un manifiesto con permisos y URL de vuelta ya puestos; copia Client ID y Secret de *Basic Information*.
- **Jira**: developer.atlassian.com/console/myapp → OAuth 2.0 integration → scopes `read:jira-work`, `write:jira-work`, `read:jira-user` → Callback URL la de arriba.
- **Bitbucket**: Workspace settings → OAuth consumers → Callback URL la de arriba; permisos Account (Read), Repositories (Write), Pull requests (Write).

Para un clic total sin pegar nada haría falta un pequeño servicio propio que guarde los secretos y haga el canje del login (como las apps comerciales).
