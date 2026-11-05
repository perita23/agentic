# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).
Cada versión se etiqueta y publica automáticamente como GitHub Release cuando el CI pasa en `main`.

## [0.43.1] - 2026-11-05

### Corregido
- **Fuera la tarjeta verde de «Resultado».** Repetía lo que Claude ya había escrito y su animación se veía mal. Ahora, al terminar, solo queda una línea discreta con el coste, la duración y los turnos; el texto aparece una única vez. Si el resultado fuera distinto de lo último que escribió Claude, se muestra en una tarjeta normal, sin animación.
- **Los correos van en su caja con «Copiar» aunque Claude no use un bloque de código.** Se reconoce el correo (desde la línea «Subject:» / «Asunto:» hasta la despedida) y se enmarca en una caja morada que se puede copiar de una vez.

## [0.43.0] - 2026-11-05

### Cambiado
- **El brillo del texto de estado es más lento** y toma los **colores del estado de la bolita** (morado al pensar, coral al escribir, verde al editar, ámbar al ejecutar…).
- **El resultado final se escribe despacio** y, cuando termina, el borde y el fondo verdes aparecen desde la esquina superior izquierda.
- Las respuestas nuevas se escriben a un ritmo más pausado.

### Añadido
- **Cajas con botón «Copiar».** Los bloques de código llevan botón de copiar, y los **correos y textos listos para pegar** salen en una caja de otro color (morada) con su etiqueta. Las ejecuciones headless le piden a Claude que los entregue así.

## [0.42.0] - 2026-11-05

### Cambiado
- **Fuera el esqueleto de barras del chat.** Ahora, mientras Claude piensa o escribe, es **el propio texto de estado** («Pensando…», «Escribiendo…») el que brilla con el degradado de la bolita.
- **Las respuestas nuevas se escriben poco a poco**, con un cursor luminoso, en vez de aparecer de golpe (en el chat y en las ejecuciones). Al abrir un historial no se anima nada.

## [0.41.0] - 2026-11-05

### Añadido
- **«Generar con Claude» al crear una PR.** En «Nueva PR», un botón hace que Claude redacte el **título y la descripción** a partir de los commits, los archivos y el diff de la rama (en el idioma de tus commits, con Resumen, Cambios y Cómo probarlo). El texto **se va escribiendo en los campos en directo**, y mientras tanto los campos brillan con el degradado de la bolita (morado, coral y azul) y una bolita pequeña «escribe» a su lado. Puedes pararlo cuando quieras y se queda lo escrito; si falla, se restaura lo que tenías. Siempre lo revisas antes de crear la PR. Usa el modelo rápido (Haiku) y envía a Claude como máximo 40 KB de diff.

## [0.40.0] - 2026-11-05

### Añadido
- **El chat te cuenta qué está haciendo mientras trabaja.** Junto a la bolita ahora sale el paso en curso en palabras (p. ej. «Docker · Leyendo logs · api» o «Editar archivo · page.tsx»), cuánto lleva el turno, **cuántos tokens ha escrito** y el tamaño del contexto. Si el modelo envía su razonamiento, se ve un fragmento mientras piensa, y queda en el chat como un bloque plegable «Razonamiento». Vale para el chat de Headless y para el Chat general.
- **Esqueleto de la respuesta con los colores de la bolita.** Mientras Claude piensa o escribe, aparecen líneas que brillan en morado, coral y azul donde llegará la respuesta, en vez de un hueco vacío. Respeta «reducir movimiento».

### Cambiado
- **El Chat general se siente más rápido:** tu mensaje aparece al instante (sin esperar a la respuesta del servidor) con su estado en vivo, y mientras Claude responde se actualiza cada 0,7 s en vez de cada 1,5 s.

## [0.39.0] - 2026-11-05

### Añadido
- **Detener desde la propia caja del chat.** Mientras Claude trabaja aparece un botón «Detener» junto al de enviar (antes sólo estaba arriba, en la cabecera).
- **Mensajes en cola.** La caja ya no se bloquea mientras Claude trabaja: escribe, pulsa «Añadir a la cola» (o Ctrl/⌘+Enter) y el mensaje espera. Cuando el turno termina bien, se envían de uno en uno y en orden (hasta 10 por conversación). La cola se guarda en el servidor, así que sigue ahí aunque salgas de la pantalla. Cada mensaje en cola se puede quitar. Si detienes a Claude o falla, la **cola se pausa** y no se envía nada a tus espaldas: tú eliges «Enviar ahora» o quitar mensajes. Los mensajes en cola nunca usan el modo que se salta los permisos.

## [0.38.1] - 2026-11-05

### Cambiado
- **Los cambios de archivos aparecen en el chat en el momento en que ocurren**, como un mensaje más, y ya no hay un panel fijo abajo. Cuando Claude edita o crea un archivo sale una tarjeta con el archivo, las líneas añadidas (+) y quitadas (−) y **el código modificado**, justo en ese punto de la conversación; se queda ahí y la siguiente modificación sale debajo. Esto vale también para lo que Claude cambia **por terminal** (`sed`, `python`, `tee`…): tras cada comando Agentic mira qué archivos han cambiado y cuelga sus cambios (con su diff) bajo ese comando. Las tarjetas grandes empiezan plegadas y la pestaña «Cambios» sigue teniendo el diff completo.

## [0.38.0] - 2026-11-05

### Cambiado
- **Chat rediseñado, más integrado en la app.** Ya no es una caja flotante con sombras: el historial y la conversación son dos paneles con el mismo estilo que el resto de secciones, con un botón «Nuevo chat» en la cabecera. Las respuestas de Claude se ven en Markdown completo (títulos, listas, tablas, código), ocupan todo el ancho de la columna y sus herramientas salen con nombre legible (p. ej. «Docker · logs»). La pantalla de bienvenida tiene sugerencias en tarjetas con icono.
- **La bolita de Agentic, a lo grande.** En la bienvenida del chat sustituye al logo. En el login (web) y en la pantalla de bloqueo de la app del Mac, el logo se queda a la izquierda y **toda la mitad derecha es la bola grande**. En los tres sitios recorre todos sus estados (pensando, escribiendo, ejecutando, leyendo, editando, buscando, esperando, hecho, error y reposo), cambiando cada dos o tres segundos. En la conversación del chat cierra el hilo: actividad en vivo mientras Claude trabaja y en calma cuando termina.

### Corregido
- **Touch ID ya no salta solo** al abrir la app del Mac ni en el login web: aparece el formulario de contraseña y Touch ID es un botón («Usar Touch ID») que pulsas cuando quieras.

## [0.37.0] - 2026-11-04

### Añadido
- **Cambiar de rama desde el chat.** En la barra de la caja de respuesta hay un botón con la rama en la que está el proyecto (y cuántos archivos tienen cambios sin commit). Al pulsarlo puedes buscar otra rama, pasar a una que sólo exista en el remoto, o crear una nueva escribiendo su nombre. Es seguro: nunca se pierden cambios (si chocaran con la otra rama, git no mueve nada y te lo explica), y no se puede cambiar mientras Claude está trabajando en el proyecto.

## [0.36.0] - 2026-11-04

### Añadido
- **Mencionar archivos con `@`.** En la caja de respuesta, escribe `@` y unas letras y Agentic sugiere archivos y carpetas del proyecto mientras escribes (primero los que empiezan por lo que tecleas, luego los que lo contienen, luego coincidencias aproximadas). Flechas para moverte, Tab o Enter para elegir, Esc para cerrar. Respeta `.gitignore` y sólo ofrece nombres, nunca el contenido.

### Corregido
- **Los cambios de Claude se ven en el chat aunque los haga por terminal.** El panel «Claude ha modificado N archivos» ya no depende sólo de las llamadas de edición: se alimenta del estado real de git del proyecto (cada pocos segundos mientras trabaja), así que también salen los archivos cambiados con `sed`, `python`, `tee`, etc., con sus líneas añadidas y quitadas. Ahora va dentro de la conversación, justo antes del indicador de actividad.

## [0.35.4] - 2026-11-04

### Corregido
- **El chat ya no se queda colgado cuando Claude lee una imagen.** Una captura llegaba como una línea de varios MB: la salida de Claude se cortaba a la mitad (el resultado se perdía) y el lector del registro se atascaba en ella: la pantalla se quedaba en «Leyendo ficheros…» mientras Claude seguía trabajando por dentro. Ahora las imágenes se guardan aparte (se ven igualmente en el chat), el lector sabe avanzar aunque una línea sea enorme, y el resultado final del turno se registra siempre, incluso si el registro llega a su tamaño máximo.

## [0.35.3] - 2026-11-04

### Añadido
- **Revisores al crear una PR.** El asistente de «Nueva PR» lista las personas que pueden revisar (los revisores por defecto del repositorio de Bitbucket ya vienen marcados; en GitHub, los colaboradores) y los añade a la PR al crearla.

### Corregido
- **El plan de Claude vuelve a mostrarse como plan.** Cuando Claude escribía el plan en su archivo de planes (`~/.claude/plans/…`) en vez de mandarlo en la llamada, la tarjeta con Markdown y los botones Aceptar / Rechazar / Hablar con Claude no salía. Ahora se lee de ese archivo (con sus ediciones) y se ofrece igualmente.
- **Bitbucket «error 400» al crear una PR.** Ahora se muestra el motivo real que da Bitbucket o GitHub (por ejemplo, «no hay cambios entre las ramas» o el campo que falla), y los commits «por delante» se cuentan contra la rama destino remota, que es con la que se compara la PR. El campo de borrador sólo se envía si lo marcas.

## [0.35.2] - 2026-11-04

### Añadido
- **Los correos se ven tal cual llegaron.** Si el mensaje trae HTML se muestra con su formato, colores y **imágenes** (también las incrustadas), como en tu cliente de correo. Va dentro de un marco aislado: sin scripts, sin acceso a Agentic, y los enlaces se abren fuera de la app. Se puede cambiar a «Ver como texto» y volver con «Ver el mensaje original». Aviso: cargar imágenes remotas puede avisar al remitente de que has abierto el correo.

### Corregido
- **Los correos ya no ensanchan la página.** Un mensaje con enlaces larguísimos (como los de Jira) hacía scroll horizontal; ahora el texto se parte dentro de su caja.
- **Los mensajes se precargan.** Al sincronizar, Agentic guarda (cifrado) el contenido de los correos nuevos, así que se abren al instante en vez de esperar al servidor. Lo ya filtrado se completa solo en la siguiente sincronización, y las siguientes sólo piden el estado de leído de lo que ya tienen.
- Los caracteres especiales de los correos (como `&#x2192;`) se muestran bien.

## [0.35.1] - 2026-11-04

### Añadido
- **Abrir un correo y leerlo.** Al pulsar un mensaje se despliega su contenido (texto sin formato, sin imágenes ni contenido externo; los adjuntos sólo se listan) y queda marcado como leído.
- **Marcar leído / sin leer a mano**, con un botón en cada mensaje. Agentic recuerda lo que marcas aunque el servidor siga diciendo otra cosa. Opcional: «Marcar leído también en tu correo» (desactivado por defecto: así Agentic no cambia nada de tu bandeja).
- **Más de una cuenta**: botón «Añadir otra cuenta» dentro de la sección de Correo.

### Corregido
- La página de Correo ya se adapta al ancho de la pantalla (antes se salía por los lados y escondía botones).

## [0.35.0] - 2026-11-04

### Añadido
- **Crear pull requests desde la sección Pull requests.** El botón «Nueva PR» abre un asistente: eliges el proyecto, la rama con los cambios (propone la actual o la más reciente que tenga commits, con cuántos commits lleva de ventaja), la rama destino, el título (por defecto el último commit) y la descripción, y puedes crearla como borrador. Agentic sube la rama a `origin` (con tu SSH/credenciales de git y, si hace falta, el token de la cuenta conectada) y abre la PR en GitHub o Bitbucket. Avisa si hay cambios sin commit, que no entran en la PR.

## [0.34.0] - 2026-11-04

### Añadido
- **El plan de Claude se ve como un documento y se puede responder.** Cuando Claude propone un plan (modo plan), aparece en una tarjeta «Plan de Claude» con Markdown bonito (títulos, listas, tablas, código) y tres botones: **Aceptar y ejecutar** (Claude sigue con permiso para editar archivos), **Rechazar** (no cambia nada y espera tus indicaciones) y **Hablar con Claude** (te lleva a la caja de respuesta). Los botones sólo salen mientras el plan está pendiente.
- **Las respuestas de Claude se muestran en Markdown** en el chat de Headless (negritas, listas, tablas, bloques de código), no como texto plano. El HTML incluido en el texto nunca se interpreta.

## [0.33.0] - 2026-11-04

### Añadido
- **Correo** (nueva sección del menú). Conecta tu correo (Gmail, Outlook, iCloud, Yahoo, Fastmail u otro IMAP) con una contraseña de aplicación. Es **sólo lectura**: Agentic nunca envía, mueve ni borra nada de tu correo; la contraseña y los mensajes se guardan **cifrados** en tu dispositivo y no viajan a ningún sitio.
- **Rutina automática** que revisa la bandeja cada 5 min – 2 h (tú eliges) y organiza los mensajes con reglas locales, **sin IA ni gasto de tokens**: urgente, reuniones, facturas y pagos, desarrollo (GitHub, Jira, Sentry…), seguridad y códigos, newsletters y personal.
- **Anidado por proyecto**: cada mensaje se cuelga del proyecto cuyo nombre aparece en el asunto o el texto. Si lo mueves tú a mano, Agentic aprende «los correos de este remitente van a este proyecto». Vista «Por proyecto» o «Por tipo», filtro de sin leer, marcar como hecho y «Sincronizar» al momento.

## [0.32.0] - 2026-11-04

### Añadido
- **Las herramientas de Claude se ven bonitas en el chat.** En vez de un «Bash» pelado, cada acción es una tarjeta que dice qué hace: `docker logs -f api` sale como «Docker · Leyendo logs · api», con su icono, el comando y la salida (últimas líneas, sin códigos de colores, con «ver todo»). Reconoce Docker y Compose, Git y GitHub, tests, npm/pip/cargo, Kubernetes, red, bases de datos, cloud, SSH y archivos. Las ediciones muestran lo que quitan y ponen, la lista de tareas sale como checklist, y cada tarjeta indica si está en curso, hecha o con error.
- **Imágenes en el chat.** Adjunta capturas con el clip, pégalas (⌘/Ctrl+V) o arrástralas a la caja de respuesta; Claude las recibe y las ve. Las imágenes que Claude devuelve (capturas, gráficos) se muestran en el chat y se abren a tamaño completo.
- **Texto largo pegado** aparece como una ficha «Texto pegado · N líneas» (se puede desplegar o quitar) en lugar de llenar la caja.

### Cambiado
- La caja de respuesta es más alta.
- La tarjeta «Claude trabajando» del menú lateral ya sólo aparece cuando no estás viendo la ejecución o el chat.

## [0.31.1] - 2026-11-04

### Cambiado
- La tarjeta «Claude trabajando» del menú lateral ya sólo aparece cuando no estás viendo la ejecución o el chat (que ya muestran su propia bola).

## [0.31.0] - 2026-11-04

### Añadido
- **Archivos modificados a la vista en el chat de Headless.** Encima de la salida aparece un panel «Archivos modificados» que se va llenando en vivo con lo que Claude crea o edita (nuevo/editado, cuántas veces), y las llamadas de edición muestran el archivo en su cabecera sin abrirlas. La pestaña «Cambios» sigue igual.
- **La bola cambia de silueta según lo que hace Claude**, para reconocer cada estado de un vistazo: escribiendo → se rompe en un enjambre de bolitas que dan vueltas; ejecutando un comando → una bolita pequeña que va de izquierda a derecha; leyendo → dos bolitas que suben y bajan; editando → tres bolitas trazando una elipse; buscando → dos bolitas en órbita ancha tipo radar; pensando → una gelatina que ondula; esperando → una bola grande que late. Cada una a su velocidad y con transiciones suaves entre formas.

## [0.30.0] - 2026-11-04

### Añadido
- **Personalizar el menú lateral.** El botón «Personalizar menú» (abajo del menú) deja ocultar las secciones que no usas, con un ojo en cada una. Se guarda en tu configuración, también en la app de escritorio. Dashboard y Ajustes no se pueden ocultar, y lo oculto sigue accesible con Ctrl K.
- **Borrar sesiones de Claude Code.** Desde la lista (icono de papelera al pasar el ratón, o «Seleccionar» para borrar varias) y desde la propia sesión. No se borran de golpe: van a una **papelera** (30 días) con «Deshacer» al instante, y desde «Papelera» puedes restaurarlas, eliminarlas para siempre o vaciarla. Las sesiones en marcha no se pueden borrar.

## [0.29.0] - 2026-11-04

### Añadido
- **Comandos de Claude en el chat de la sesión.** Escribe `/` en la caja de respuesta de Headless o en el Chat y aparece un menú con los comandos: `/plan` (Claude sólo planifica), `/edits` (aceptar ediciones), `/ask` (preguntar), `/auto` y `/model` (sonnet, opus, haiku o fable). Puedes escribirlos solos para dejar el modo ajustado o seguidos del mensaje (`/plan refactoriza el login`). También salen **tus comandos personalizados y skills** de Claude Code (de `~/.claude` y del proyecto), con su descripción, y se envían a Claude tal cual. Además, ahora el Chat y Headless tienen selector de permisos (preguntar, plan, aceptar ediciones, auto).
- **Biblioteca** (nueva sección): indexa los **artifacts de Claude**, pull requests, incidencias (GitHub, Jira, Linear) y documentos (Google Docs, Notion, Figma) que han salido en tus sesiones, con el texto que los rodea como título, el proyecto, la fecha y cuántas veces se mencionan. Se busca, se filtra por tipo, se abren en el navegador con un clic y llevan a su sesión. Todo se lee de tus sesiones locales: la primera vez indexa las más recientes primero y no se envía nada fuera.

## [0.28.1] - 2026-11-04

### Cambiado
- **La bola de la IA, mucho más calmada.** Antes se movía demasiado. Ahora el movimiento es lento y continuo, casi hipnótico, y los estados se distinguen por el color, el ritmo de respiración y una forma ligeramente distinta (más alargada en horizontal al escribir, en vertical al leer, más abierta al buscar, compacta al esperar…), no por moverse más. Los cambios de estado son más pausados.

## [0.28.0] - 2026-11-04

### Corregido
- **Headless: responder ya no crea otra ejecución.** Cuando le escribes a Claude en una ejecución headless, tu mensaje y su respuesta aparecen debajo, en la misma página y en la misma conversación, como en el Chat. Antes cada mensaje abría una ejecución nueva y te llevaba a otra página. En la lista de Ejecuciones hay una sola fila por conversación, con el estado de su último mensaje. El coste, la duración y los turnos suman toda la conversación, y los cambios (diff) cubren todo el hilo.

### Cambiado
- **La bola de la IA, rehecha.** Sin brillo. Al cambiar de estado la forma se transforma de manera continua (antes saltaba de un movimiento a otro), y cada estado se mueve de forma muy distinta: gota pequeña que respira en reposo, esferas que orbitan sueltas al pensar, banda horizontal al escribir, columna vertical al leer, inclinada y grumosa al editar, pulsante al ejecutar, repartida y abierta al buscar, grande y compacta al esperar, diminuta al terminar y temblorosa si falla.
- La bola va al final de la salida, donde Claude está escribiendo, y no en una franja fija arriba.

## [0.27.0] - 2026-11-04

### Añadido
- **Comentar en Jira desde una sesión**: en cada respuesta de Claude (ejecuciones y sesiones) hay un botón «Comentar en Jira». Edita el texto y se guarda como comentario de la incidencia. La clave (por ejemplo INOX-2021) se toma de la tarea vinculada o se busca en la sesión; siempre puedes cambiarla.
- **Tu uso de Claude y cuándo se reinicia**, en las ejecuciones headless y en la lista de Ejecuciones: la ventana de 5 horas y los límites semanales con su barra de uso, el estado («Cerca del límite»…) y la cuenta atrás hasta el reinicio con su hora. Son los datos que informa Claude Code al ejecutar, así que se actualizan con cada ejecución. Incluye también los tokens de hoy en tu dispositivo.

### Cambiado
- **La bola de la IA se mueve mejor**: al cambiar de estado, el color, la velocidad y el brillo se transforman poco a poco en vez de saltar. Las gotas cambian de forma, aparecen con una pequeña animación y cada estado tiene su movimiento propio: gira al pensar, late mientras espera, pulsa al ejecutar, «explota» un poco al terminar y se sacude si falla.

## [0.26.0] - 2026-11-04

### Añadido
- **La bola líquida muestra lo que hace Claude.** Cambia de color y de movimiento según el estado: pensando, escribiendo la respuesta, leyendo ficheros, editando, ejecutando un comando, buscando, esperando tu respuesta, terminado o con error. Aparece en el Chat mientras Claude responde, en la página de cada ejecución y, en pequeño, en la barra lateral mientras haya algo en marcha (con enlace a esa ejecución). El estado siempre se escribe también con texto.
- **Responder desde Headless**: cada ejecución headless tiene ahora una caja para responder a las preguntas de Claude o enviarle otra instrucción. Continúa la misma conversación de Claude en una ejecución nueva y puedes elegir los permisos (preguntar, sólo planificar o aceptar ediciones). Si Claude termina con una pregunta o una herramienta necesitaba permiso, la bola pasa a «Esperando tu respuesta».
- **Enlaces clicables**: las URL que aparecen en el Chat, en las ejecuciones y en las sesiones ya se pueden pulsar y se abren en el navegador. Los **artifacts de Claude** (`claude.ai/artifact/…`) se muestran como un botón «Abrir artifact».

### Seguridad
- Sólo se enlazan URL `http(s)`; el resto de esquemas y cualquier HTML se muestran como texto.

## [0.25.2] - 2026-11-04

### Cambiado
- **App de Mac: la pantalla de inicio es ahora la de pantalla completa, dividida 50/50.** A la izquierda, sobre negro, crear contraseña o desbloquear (con Touch ID si lo activaste); a la derecha, un líquido animado con los colores del logo (esferas que se funden y se separan, con brillo) y una tarjeta de cristal. Antes salía una ventana pequeña. En ventanas estrechas se oculta la parte animada y se respeta «reducir movimiento».

## [0.25.1] - 2026-11-04

### Corregido
- **App de Mac: la ventana de inicio salía negra y vacía.** La pantalla de bloqueo (crear contraseña o desbloquear) no se cargaba por una medida de seguridad de Electron que impide leer archivos desde dentro del paquete. Ahora la pantalla se construye sin esa carga y, si algo fallara, la app lo dice en lugar de quedarse en negro.

## [0.25.0] - 2026-11-04

### Añadido
- **Crear la PR desde la tarea**: en una tarea con worktree, el botón «Crear PR» hace commit de los cambios pendientes, sube la rama y abre la pull request en GitHub o Bitbucket, con título, descripción y opción de borrador. La tarea pasa a Revisión y muestra el enlace a la PR, también en el tablero.
- Si tu git no puede subir la rama por https, Agentic lo reintenta con la cuenta conectada en Integraciones. El token nunca aparece en la línea de comandos.

### Cambiado
- Dependencias al día: React 19.3.1 y las acciones de GitHub en su última versión.

## [0.24.0] - 2026-11-04

### Añadido
- **Copias de seguridad** (Ajustes → Copias de seguridad y tus datos): cada día se guarda una copia automática y se conservan las 7 últimas. También puedes guardar una copia cuando quieras, descargarla o restaurarla con un clic.
- **Exportar e importar**: lleva tus tareas, plantillas, proyectos, programadas, presupuesto, chats e historial de ejecuciones a otro equipo con un archivo JSON. Antes de restaurar se guarda siempre una copia de tus datos actuales, así que todo se puede deshacer.
- **Borrar todos mis datos**: deja Agentic como recién instalada, incluidas las conexiones y sus credenciales. Tu acceso con contraseña y Touch ID se mantiene, y tus repos y sesiones de Claude Code no se tocan.

### Seguridad
- Las copias nunca incluyen credenciales de integraciones y se guardan con permisos 0600.

## [0.23.0] - 2026-11-04

### Añadido
- **Presupuesto** (en Analítica): límites diarios y mensuales de gasto, en USD reales de las ejecuciones lanzadas desde Agentic, y de tokens de todo Claude Code en tu dispositivo. Cada uno tiene su barra de progreso.
- **Avisos**: una franja en la parte superior y un mensaje por Slack (si está conectado) al llegar al umbral de aviso (80 % por defecto) y al superar el límite. Cada aviso se envía una sola vez por periodo.
- **Pausa de lo automático**: con un límite en USD superado, la cola de tareas y las programadas no arrancan. Lo que lances tú a mano sigue funcionando. Se puede desactivar.

## [0.22.0] - 2026-11-04

### Añadido
- **Programadas** (nueva sección): trabajos recurrentes de Claude Code, como un resumen de commits cada mañana, tests cada noche o una revisión semanal de dependencias. Se pueden programar ciertos días a una hora o cada X horas.
- Plantillas de un clic, botón «Ejecutar ahora», pausar o activar con un interruptor, enlace a la última ejecución y cuenta atrás hasta la siguiente.
- Se ejecutan mientras Agentic esté abierta. Si estaba cerrada a la hora prevista, la ejecución se recupera una vez al abrir, salvo que hayan pasado más de 6 horas.

### Seguridad
- Las programaciones nunca pueden usar «Sin permisos» (`bypassPermissions`), y cada una puede tener un presupuesto máximo en USD.

## [0.21.0] - 2026-11-04

### Añadido
- **Tareas en worktrees aislados**: al ejecutar una tarea puedes marcar «Trabajar en un worktree aislado». Claude trabaja en su propia rama (`agentic/<tarea>`) y en su propia carpeta, así tu copia del repo no se toca y puedes lanzar varias tareas a la vez sin que se pisen.
- En la tarea ves la rama, los commits que lleva y los ficheros sin commit. Puedes copiar la ruta, quitar la carpeta conservando la rama, o borrar ambas.
- Volver a ejecutar la tarea reutiliza su worktree. Si lo quitaste, se crea de nuevo sobre la misma rama, con todo lo que ya tenía.
- Funciona en monorepos: si el proyecto es una subcarpeta, Claude arranca en esa misma subcarpeta dentro del worktree.

### Seguridad
- Los worktrees se crean con git blindado (sin hooks, filtros ni fsmonitor del repositorio) y fuera del repo, en `~/.agentic/worktrees`.

## [0.20.0] - 2026-11-04

### Añadido
- **Permisos de Claude Code** (nueva sección «Permisos»): decide qué puede hacer Claude sin preguntarte, qué debe confirmar siempre y qué tiene prohibido, para todos tus proyectos o sólo para uno (compartido por git o sólo para ti). También puedes elegir el modo con el que arranca cada sesión.
- **Recetas rápidas**: proteger `.env` y claves, ejecutar tests y lint sin preguntar, git de sólo lectura, confirmar cada `git push` o bloquear comandos peligrosos, todo con un clic.
- Aviso cuando una misma regla está en varias listas, explicando cuál gana.

### Seguridad
- Sólo se modifica el bloque `permissions` de `settings.json`; el resto de tus ajustes se conserva. Si el fichero no es JSON válido, Agentic no lo toca.

### Corregido
- Al terminar una ejecución, su registro ya está completo: antes podían faltar las últimas líneas si lo abrías justo al acabar.

## [0.19.0] - 2026-11-04

### Añadido
- **Servidores MCP** (nueva sección «MCP»): ve todos los servidores MCP de Claude Code (de todos tus proyectos, privados de un proyecto o compartidos en `.mcp.json`), añádelos y quítalos sin editar JSON. Plantillas de un clic para Playwright, Context7, GitHub, sistema de ficheros y Sequential thinking. Los cambios se hacen con `claude mcp add/remove`, así Claude Code sigue siendo la fuente de verdad.

### Seguridad
- Los valores de variables de entorno y cabeceras de los servidores MCP nunca llegan al navegador: sólo se muestran sus nombres.

## [0.18.0] - 2026-11-03

### Cambiado
- **Nuevo inicio de sesión** a pantalla completa: a la izquierda, sobre negro, el acceso con Touch ID; a la derecha, una animación con las piezas del logo y su degradado (se detiene si tienes activado «reducir movimiento»).

### Añadido
- **Distintivo de seguridad** en Ajustes y en la página de descarga: «Diseñada según OWASP ASVS 5.0 (nivel 1) y la lista de seguridad de Electron», con enlace a los controles. Es una revisión propia, no una auditoría externa.

## [0.17.0] - 2026-11-03

### Añadido
- **Chat con Claude** (nueva sección «Chat»): habla con Claude sin elegir proyecto. Cada conversación continúa la misma sesión de Claude Code, con selector de modelo, respuestas con formato (código, listas, títulos) y las herramientas que use Claude.
- **Historial de chats**: buscar, fijar y borrar conversaciones; las que siguen respondiendo se marcan. Todo se guarda en tu dispositivo.

### Corregido
- En móvil, las tarjetas del dashboard ya no se salen de la pantalla y el buscador superior no se parte en varias líneas.

## [0.16.0] - 2026-11-03

### Cambiado
- **Nuevo logo**: una «A» brutalista de alto contraste (pierna gruesa partida por una ranura, pierna fina y barra que sobresale) con el degradado de Agentic sobre negro.
- La app nombra tu dispositivo (por ejemplo «MacBook Pro de Hugo») en lugar de «esta máquina».

### Seguridad
- **Credenciales cifradas en disco**: los tokens de las integraciones y los secretos OAuth se guardan cifrados (AES-256-GCM). En la app de Mac la clave vive en el **Llavero de macOS**; los ficheros antiguos se cifran al arrancar.
- **App de Mac endurecida** según la lista de seguridad de Electron: el servidor corre en un proceso aislado y se desactivan los *fuses* peligrosos (ejecutar la app como Node, `NODE_OPTIONS`, `--inspect`); el código sólo se carga desde el paquete con integridad verificada; cookies cifradas; sin DevTools en versiones publicadas; `<webview>` bloqueado.
- **Actualizaciones firmadas** (opcional): si se configura la clave del proyecto, la app sólo instala actualizaciones cuyo manifiesto esté firmado (Ed25519). Las releases incluyen además `SHA256SUMS.txt` y un SBOM.
- **Dependencias**: corregida una vulnerabilidad alta en `js-yaml` (lectura del manifiesto de actualizaciones); auditoría también de la app de escritorio en cada CI y actualizaciones automáticas con Dependabot.
- **Sin fugas en notificaciones**: las notificaciones del sistema ya no muestran el texto del prompt (se ven en la pantalla de bloqueo y quedan en el Centro de notificaciones).
- Documentado el estado frente a OWASP ASVS / Top 10 y la lista de Electron en `docs/SECURITY.md`.

## [0.15.0] - 2026-11-03

### Añadido
- **Novedades al actualizar**: la primera vez que abres Agentic después de una actualización ves qué ha cambiado (todas las versiones desde la última que viste).

### Seguridad
- Las direcciones de los repositorios ya no muestran credenciales: si un remoto lleva un token dentro (`https://usuario:token@…`), Agentic lo oculta.

### Corregido
- En la ficha de un proyecto, las direcciones largas ya no se salen de su tarjeta.
- Las listas largas (commits, ficheros, scripts, sesiones y ejecuciones del dashboard) tienen su propio scroll y no estiran la página.

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
