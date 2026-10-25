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
