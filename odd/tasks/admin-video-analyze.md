# Feature: admin-video-analyze (botón "Analizar" en el CRM de videos)

Objetivo: dejar el análisis de videos disponible desde el CRM
(`vidasaludable.rincom.es/admin/videos`) sin terminal: la fila del video dispara
el pipeline `analyzeVideo()` en el backend, de forma asíncrona, escribiendo
directo en la base de producción. Rama: `feat/admin-video-analyze` (desde
`main` = 908eb6d8).

Decisiones del usuario (2026-10-25): el botón aparece en borradores Y en
videos ya analizados ("Re-analizar"); se aprueba agregar `ffmpeg` + `yt-dlp` a
la imagen Docker del backend en producción (cambio de infraestructura).

## Specs

### S1 — Botón "Analizar" en videos Borrador

> "quiero proceder con el boton para dejar esta parte lista"

Cada fila de video en estado `draft` muestra un botón **Analizar**.
`POST /admin/videos/:id/analyze` lanza `analyzeVideo()` en background en el
proceso backend (fire-and-forget con single-flight) y responde **202** de inmediato
— el request NUNCA espera el análisis (tarda minutos). Estado nuevo de
análisis: `analysis_state = 'running'` (columna nueva, NO se toca el enum
`VIDEO_STATUSES` existente). La fila muestra el chip "Analizando…" y la tabla
hace **polling** de `GET /admin/videos` cada ~4s mientras algún video esté en
`running`, y se detiene cuando ninguno lo está.

### S2 — Botón "Re-analizar" en videos Analizado (con confirmación)

> "Borradores + re-analizar"

Videos `analyzed` muestran **Re-analizar**, que dispara el mismo endpoint. Es
idempotente (el pipeline reemplaza los segmentos del video), por lo que el
disparo pasa por `ConfirmActionDialog` con advertencia explícita de que los
segmentos existentes se reemplazan (los `enabled` incluidos). Solo un análisis
a la vez en toda la instancia: un segundo disparo → **409**
`{ error: "analysis already running" }`.

### S3 — Errores visibles y reintento

> "dejar esta parte lista" (flujo completo sin terminal)

Si el análisis falla (sin subtítulos, cuota Gemini, yt-dlp), la fila muestra
el motivo en rojo (columna nueva `analysis_error` TEXT) y el botón sigue
disponible como reintento: re-disparar limpia `analysis_error` y vuelve a
`running`. El estado del video (`draft`/`analyzed`) NO cambia por un fallo y
los segmentos existentes NO se tocan en un fallo (el reemplazo solo ocurre
tras un análisis exitoso — verificar el orden de persistencia en
`analyzeVideo` antes de implementar). Al arrancar el backend, cualquier
`analysis_state = 'running'` huérfano (reinicio a mitad de análisis) se
resetea a `NULL` con `analysis_error = 'Análisis interrumpido por reinicio'`.

### S4 — El CRM no rompe lo existente

El enum `VIDEO_STATUSES` (`draft|analyzed|cut|published`), la CLI
`pnpm video:analyze` y el flujo manual de aprobación de segmentos
(`enabled=0` → activar en el CRM) siguen intactos. Migración adicional e
idempotente (`ALTER TABLE videos ADD COLUMN` ×2) siguiendo el patrón de
`migrate.ts` (sin `;` dentro de comentarios SQL — gotcha conocido).

### S5 — Infraestructura: ffmpeg + yt-dlp en la imagen

> "Sí, sumar dependencias"

`backend/Dockerfile.prod`: `ffmpeg` vía apt y `yt-dlp` (binario estático
recomendado sobre el paquete Debian, que va desactualizado). Verificar en
container que el runner `ytdlp` funciona tal como en local (incluye
`--js-runtimes node` según el gotcha de sesiones anteriores). Deploy del
backend en Hetzner con rebuild del contenedor (usuario lo aprobó).

### S6 — Tests (RED primero)

- Backend: endpoint 202 en disparo válido; 409 con análisis en curso; 400 id
  inválido; 404 video ausente; error de analyze → `analysis_state` vuelve a
  `NULL` + `analysis_error` poblado y segmentos intactos; boot recovery
  (running huérfano → NULL + mensaje); re-análisis exitoso reemplaza
  segmentos. Runner con dependencias inyectables (sin red/subprocesos en
  tests, patrón video-pipeline.test.ts).
- Frontend: botón Analizar en draft / Re-analizar en analyzed; confirmación
  en re-analizar; chip "Analizando…"; polling activo mientras `running` y
  detenido al terminar; mensaje de error visible; 409 inline.

## Tasks

- T1 — Migración + schema: columnas `analysis_state` TEXT y `analysis_error`
  TEXT en `videos` (ALTER idempotente), tipos Drizzle, helpers
  `startAnalysis/markAnalysisRunning/finishAnalysis(…)` en videoService.
  Tests backend. commit `feat(admin): video analysis state columns`
- T2 — Backend: `POST /admin/videos/:id/analyze` con runner inyectable
  (single-flight, 202, 409, 404), boot recovery de running huérfano, error →
  analysis_error + segmentos intactos. Tests (RED primero). commit
  `feat(admin): async video analyze endpoint with single-flight guard`
- T3 — Frontend: botones Analizar/Re-analizar + ConfirmActionDialog en
  re-analizar, chip "Analizando…", polling cada 4s mientras running, error en
  rojo con reintento, manejo del 409. Tests (RED primero). commit
  `feat(admin): analyze button and analysis polling in videos CRM`
- T4 — Infra: Dockerfile.prod con ffmpeg + yt-dlp estático; smoke de
  yt-dlp/ffmpeg/`--js-runtimes node` en la imagen. commit
  `build(backend): ship yt-dlp and ffmpeg in the prod image`
- T5 — Verificación total: suites backend+frontend, tsc ×2, build; assess RDD;
  verificador independiente si el plan lo exige.
- T6 — Entrega: rama, PR (issue vinculado), CI verde, merge a decisión del
  usuario, deploy backend con rebuild en Hetzner + smoke en prod.

## Log

- L1 — "vale ahora si quiero proceder con el boton para dejar esta parte
  lista" (contexto previo: "cuando coloco un video nuevo se crean lo
  segmentos o no se crean los segmentos? conversemos antes de lanzar codigo";
  el formulario solo registra el video, los segmentos los crea el pipeline
  `video:analyze`, hoy solo por terminal + import manual a prod).
- L2 — Decisiones: alcance "Borradores + re-analizar"; infraestructura "Sí,
  sumar dependencias" (ffmpeg + yt-dlp en la imagen Docker del backend).
- L3 — Verificación independiente (gentle-ai-verify, ronda 1): **FAIL**
  (2 Medium, 6 Low, 3 Info) → fix ronda 1 commit `fix(admin): harden the
  analysis pipeline (verify round 1)`:
  - **M1** arreglado: `videoService.replaceSegments` atómico (transaction
    delete+insert) y usado por `analyzeVideo` ANTES de tocar status → un fallo
    a mitad de swap ya no puede perder segmentos (tests: success + rollback).
  - **M2** arreglado: watchdog de 10 min en el runner (`{timeoutMs}` inyectable
    en tests) → job colgado = failure normal en español + slot libre.
  - **L1** arreglado: `claim` libera el slot si el UPDATE truena (propaga,
    no finge 409). **L2**: doble guard (failAnalysis + catch final) → nunca
    unhandledRejection. **L5**: el polling también corre cuando la lista está
    en error (carga inicial fallida descubre el job). **L6**: 409 traducido
    al español en el CRM.
  - **Aceptados/diferidos**: L3 (ambigüedad 409 solo alcanzable con dos
    procesos sobre la misma SQLite — prod corre un único `api`), L4
    (single-flight por instancia — ídem), I1 (yt-dlp unpinned, documentado),
    I2 (`--js-runtimes node` del spec no hizo falta: el smoke real de la
    imagen descargó subs sin él → S5 ajustado), I3 (build+smoke de la imagen
    SÍ ejecutados localmente: build verde + fetch 1.33MB).
  - Suites al cierre de la ronda: backend 310/310, frontend 242/242, tsc ×2,
    build OK.
- L4 — Verify ronda 2: **PASS** (6/6 fixes de ronda 1 confirmados, suites
  310/310 + 242/242) con hallazgos residuales → fix ronda 2 (la última):
  - **Medium arreglado**: el polling por error (L5) borraba los banners
    inline (409 español, validación de formulario) a los ≤4s — ahora solo
    hace retry de error cuando la carga NUNCA tuvo éxito (`loadedOnce`);
    test r2 con flush determinista (setTimeout(0) real) que fallaba en
    falso-GREEN sin él.
  - **Low arreglado (L-2)**: la rama de video nuevo creaba la fila
    `analyzed` antes del swap → ahora `draft` + `updateVideo(analyzed)`
    tras swap exitoso (invariante "status untouched on failure" real).
  - **Aceptados**: L-1 (timeout no cancela el analyzer — zombie
    last-writer-wins inofensivo; cancelar end-to-end requiere
    AbortController por yt-dlp/Gemini → futuro), Info (swap y update en
    transacciones separadas: M1 cubre pérdida de segmentos, fuera de
    alcance), poll sin backoff mientras la primera carga nunca funciona
    (self-heal deseado), L3/L4 (single-flight por instancia).
  - Suites al cierre: backend 310/310, frontend 243/243, tsc ×2, build OK.
- L5 — INCIDENTE EN PROD (2026-10-25, tras el deploy) + fix:
  El primer clic real en "Analizar" (v7TySoNZ9q0) falló con el error en rojo
  correcto (S3 funcionó) pero con dos causas apiladas en el mensaje:
  (a) **I2 se materializó**: yt-dlp ≥2026.10 exige runtime JS para los
  challenges de YouTube (`No supported JavaScript runtime`) — el flag
  `--js-runtimes node` del spec no estaba en el código; mi smoke original
  solo probó subtítulos y pasó sin él.
  (b) **Challenge anti-bot por IP de datacenter**: 3 sondas desde el
  contenedor (metadata K6lOOEbUiDI, subs v7, player_client=tv) → todas
  "Sign in to confirm you're not a bot"; a media tarde el mismo smoke había
  bajado 1.3MB → el challenge se activó con el uso, no es por video.
  **Fix (decisión del usuario: "Impersonation primero")**: prueba de
  concepto en contenedor descartable con `pip install "yt-dlp[default]"
  curl_cffi` → extracción normal desde la misma IP →
  - media.ts: `--js-runtimes node` en getMetadata/getTranscript/
    downloadVideo (tests de args actualizados, RED 3/3 → GREEN 39/39);
  - Dockerfile.prod: el binario standalone ADD no tiene target de
    impersonation → reemplazado por `pip install --break-system-packages
    "yt-dlp[default]" curl_cffi` (+python3-pip); node de la imagen es el
    runtime EJS.
  Si el impersonation no alcanzara en el futuro, el plan B documentado es
  cookies (`--cookies`, archivo fuera de git).
- L7 — Ajuste operativo de los cookies (post-L6): yt-dlp ESCRIBE el jar al
  salir (cookies frescas tras la rotación de Google) → un montaje ro aborta
  con `OSError 30`; la ruta que funciona es el volumen rw `data/`:
  `/opt/vidasaludable/data/secrets/youtube-cookies.txt` →
  `/app/data/secrets/youtube-cookies.txt` vía `YT_COOKIES_PATH` en el .env
  de prod. Verificado en vivo: probe devuelve `Nutrilite Luis Collantes |
  3380`. El montaje ro de `./secrets` se eliminó de compose y todos
  los textos/docs se alinearon (PR de docs; verify ronda 1 FAIL por bloque
  duplicado en .env.example + textos stale → fix).
- L6 — Cierre del diagnóstico de prod (decisión del usuario: "Cookies"):
  PoC VÁLIDO en la IP de Hetzner con la receta completa (node v20 +
  curl_cffi + yt-dlp 2026.10 + --js-runtimes node) → **sigue el bot
  challenge**: el impersonation NO basta para IP de datacenter (el PoC que
  "funcionó" corrió en IP residencial, nunca bloqueada — lección: probar
  siempre en la IP afectada). Cableado de plan B implementado:
  `YT_COOKIES_PATH` env → flag `--cookies` en getMetadata/getTranscript/
  downloadVideo (sin env = sin flag, comportamiento previo intacto; test
  RED→GREEN con vi.stubEnv), el montaje ro de `./secrets` quedó después
  sin uso (yt-dlp escribe el jar — ver L7),
  `secrets/` en .gitignore (el archivo NUNCA toca git). Pendiente operativo:
  exportación de cookies por el usuario → scp al servidor → env en .env de
  prod → rebuild → reintento del botón Analizar.
- L8 — INCIDENTE 2 (2026-10-26): el primer clic real con cookies funcionó
  a medias — la PRIMERA extracción con `--cookies <master>` tuvo éxito
  (probe: "Nutrilite Luis Collantes | 3380"), pero yt-dlp **reescribió el
  jar a la salida PODÁNDOLO**: 26→13 cookies, desaparecieron SID,
  __Secure-1PSID, LOGIN_INFO, SAPISID, SIDCC (familia de autenticación) →
  todo análisis posterior volvió al bot check (el error rojo del CRM era
  el registro del intento post-poda). El `--help` lo confirma: `--cookies
  FILE` es "read cookies from AND dump cookie jar in"; el archivo ro
  aborta (OSError 30) y el rw se pudra — no hay flag "no-dump".
  **Fix**: `prepareCookies()` en media.ts — copia master→`<path>.run`
  descartable por corrida, `--cookies` con la copia, dispose(rm) en
  finally; master NUNCA es el target (queda byte-idéntico run tras run).
  Si la copia falla (master ausente) → corre SIN cookies (error honesto)
  y warn, sin crear nada en la ruta maestra. Tests con el incidente
  simulado (dump destructivo sobre la copia + master intacto + .run
  limpiado + fallback). Master restaurado en prod desde el original del
  usuario (26 cookies, 600). Suites: 41/41 pipeline, tsc OK.
- L9 — Verify del fix L8: **PASS** (8 hallazgos Low/Info, invariante "master
  nunca es target" probado en todos los intercalados). Fix incluido:
  comentario de compose desactualizado (ya no "keeps rotated cookies
  fresh" — las rotaciones caen en el `.run` descartable). **Aceptados**:
  F2 carrera de nombre `.run` si CLI y servidor corren a la vez (el server
  tiene single-flight; consecuencia: intento transitorio reintentable;
  master intacto en todo intercalado — sufijo único pid+ts queda como
  mejora futura), F3 no-cancelación tras timeout (mismo sobre), F4 gaps de
  tests (transcript/download/rejection-dispose), F5 asserts débiles del
  fallback, F6-F8 Info. 312/312 + tsc reproducidos por el verificador.
- L10 — Lecciones operativas de la saga (2026-10-26):
  (a) **Freshness de cookies**: Google rota sidts/SIDCC en minutos-horas;
  exportar con YouTube CERRADO y usar YA (yt-dlp avisa "no longer valid,
  rotated in browser"). Un probe local NO valida: la IP residencial pasa
  sin autenticación — solo el server (datacenter) lo exige.
  (b) **Deploy**: el webhook de Hetzner ejecuta `compose up` solo al hacer
  push → NUNCA correr un `compose up` manual en paralelo (causó conflicto
  de nombre de contenedor y DOWNTIME del API ~minutos; restaurado con un
  `up -d` único). Coordinar: push → esperar webhook, o desactivar uno.
  (c) **Cosmético**: el contenedor quedó con nombre hashed
  `4a972eadb4f0_vidasaludable-api-1` a raíz del conflicto — renombrar en el
  próximo mantenimiento (down/up en ventana sin tráfico).
  (d) **Gemini transitorio**: "no es JSON válido" con modelos flash-lite
  es NO determinista (temperature>0 sin maxOutputTokens) — reintentar
  primero (clic o CLI); si persiste 2×, investigar (maxOutputTokens,
  chunking). Flujo de import local→prod validado 2× hoy (K6lOO 17, v7 27):
  INSERTs con quote(), backup .backup, transacción, integrity_check.
