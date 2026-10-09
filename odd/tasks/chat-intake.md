# Feature: chat-intake (un solo botón: ficha corta → chat personalizado)

## User decisions (2026-10-09)

- La encuesta de 95 síntomas (scoring + PDF + email) **se conserva como paso
  opcional dentro del chat** — el bot la ofrece tras su recomendación.
- El botón verde "Prevenición" **se elimina**: queda **un solo botón** (el
  chat). El `AssessmentWidget` solo se abre vía marcador `[ASSESSMENT]`.

## Problem

Hoy hay dos botones flotantes con dos flujos paralelos:

- `AssessmentWidget` (Prevenición): access code → nombre/sexo/edad → 95
  síntomas en 8 pasos → scoring determinista. Funciona pero es largo y frío.
- `ChatWidget`: access code → registro+consentimiento → Gemini con catálogo,
  guías, compras y videos inyectados — pero **no conoce al usuario** (ni edad,
  sexo, objetivo ni hábitos), así que no puede personalizar.

Ambos comparten `AccessCodeGate` + referrer (duplicación de puerta).

## Design

Un solo botón (chat). Flujo:

```
boot → access_code → registro/consentimiento (ya existe)
     → INTAKE (nuevo, determinista, sin LLM)
     → chat abierto con perfil inyectado en el prompt
```

### Intake (5 pasos, chips de respuesta, dentro del widget)

| # | Pregunta | Control |
|---|----------|---------|
| 1 | Edad + sexo | input numérico + chips M/F (el nombre ya lo pide el registro) |
| 2 | Objetivo principal | chips: energía · inmunidad · huesos · piel/cabello · digestión · sueño |
| 3 | Hábitos | dieta (omnívora/vegetariana/vegana) + actividad física (nada/leve/moderada/intensa) |
| 4 | Sueño y estrés | chips (horas / bajo-medio-alto) |
| 5 | Pregunta abierta | "¿Hay algo que te preocupe hoy?" (texto libre) |

Un solo `POST /api/assistant/profile` al final. Determinista: sin alucinaciones.

### Backend

- Tabla `customer_profile` (1:1 con `customers`) + migración con el patrón
  ALTER TABLE try/catch existente en `migrate.ts`.
- Rutas `GET/POST /assistant/profile` (customer-scoped, misma validación que
  `/history`).
- `profileBlock(ctx)` nuevo en `buildSystemPrompt` (`agent/prompt.ts`):
  inyecta PERFIL DEL USUARIO (edad, sexo, objetivo, hábitos, sueño, estrés,
  nota abierta). Bloque filtrado si no hay perfil (convención de bloques
  vacíos existente).
- Instrucción de flujo en el prompt: con perfil → 2-3 preguntas abiertas de
  seguimiento → recomendación con `[ref]`/`[VIDEO:id]` → ofrecer chequeo
  completo con marcador `[ASSESSMENT]`.

### Frontend

- Fase `intake` nueva en `ChatWidget` (tras registro, la primera vez; si ya
  hay perfil, se salta). Persistencia de perfil en el servidor (no solo
  localStorage): `GET /assistant/profile` al boot decide la fase.
- Marcador `[ASSESSMENT]` en la respuesta del bot → tarjeta-botón que abre el
  `AssessmentWidget` (mismo patrón validado que `[VIDEO:id]`, con lista blanca
  de ids habilitados).
- Se quita `<AssessmentWidget />` de `App.tsx` como botón flotante: el widget
  pasa a renderizarse solo cuando está abierto (o se le añade control
  externo `open/onClose`).

## Tasks

| # | Task | Edit surfaces | Verification |
|---|------|---------------|--------------|
| T1 | Backend: tabla `customer_profile` + migración + schema + servicio + rutas `GET/POST /assistant/profile` | `backend/src/**`, `backend/test/**` | RED: test de integración (sin perfil → 404/null, POST → 200, GET → perfil) → GREEN; suite backend verde |
| T2 | Backend: `profileBlock` + instrucción de flujo guiado en `agent/prompt.ts` y cableado en `assistant.ts` | `backend/src/agent/**`, `backend/src/routes/assistant.ts`, `backend/test/**` | RED: test de prompt (con perfil → bloque presente con datos; sin perfil → bloque ausente) → GREEN; test de que el prompt pide seguimiento + `[ASSESSMENT]` |
| T3 | Frontend: fase `intake` en `ChatWidget` + componente `ChatIntake` (5 pasos con chips) + `POST/GET /profile` | `frontend/src/app/components/chat/**`, `frontend/test/**` | RED: test de flujo (tras gate → intake visible; completar → chat y perfil enviado) → GREEN |
| T4 | Frontend: marcador `[ASSESSMENT]` → tarjeta que abre el wizard; quitar botón "Prevenición" de `App.tsx` | `frontend/src/app/**`, `frontend/test/**` | RED: test (mensaje con `[ASSESSMENT]` renderiza tarjeta; clic abre wizard; App no renderiza botón suelto) → GREEN |
| T5 | Verificación E2E local + docs (README/feature doc) | `README.md`, `odd/tasks/chat-intake.md` | backend+frontend suites verdes, `pnpm build` limpio, smoke manual en localhost:5174 |

## Progress

- [x] T1 — RED 4/4 → GREEN 4/4; suite backend 17 files / 221 tests; tsc clean
  (worker: `customer_profile` DDL + drizzle mirror + `profileService` upsert/
  getByCustomer + POST/GET `/assistant/profile`; wire shape snake_case)
- [x] T2 — RED 6/9 → GREEN 9/9; suite backend 18 files / 230 tests; tsc clean
  (worker: `profileBlock` + `ProfileContext` + bloque `GUIDED_FLOW` siempre
  presente tras HARD_LIMIT (intacto), 5º parámetro opcional de
  `buildSystemPrompt`, `/ask` inyecta `profiles.getByCustomer`)
- [x] T3 — RED 7/7 → GREEN 7/7; suite frontend 8 files / 78 tests; tsc clean
  (worker: fase `intake` + `ChatIntake` de 5 pasos con chips, boot decide
  intake-vs-chat vía GET /profile, POST snake_case antes de entrar al chat,
  error de guardado ⇒ reintento sin entrar; parent reapiló la rama sobre
  `feat/ci-quality-gates` para tener `tsconfig` + CI y arregló 2 TS2532 del
  test con `noUncheckedIndexedAccess`)
- [x] T4 — RED 16/17 failed → GREEN 17/17; suite frontend 9 files / 86 tests;
  tsc clean; `pnpm build` 8.28s (worker: `AssessmentCard` + split outermost
  `[ASSESSMENT]`, `onOpenAssessment` drill, `AssessmentWidget` controlado
  open/onClose sin botón flotante, estado levantado en `App.tsx`)
- [ ] T5
- [x] T5 — smoke E2E local: register → POST/GET profile → `POST /assistant/ask`
  real con Gemini: apertura con 2 preguntas de seguimiento basadas en el perfil
  (sueño 5-6h), recomendación personalizada citando [110178]/[120571] usando
  estrés alto del perfil, `[ASSESSMENT]` emitido, guard sin bloqueos. Botón
  único verificado en App.tsx; suites finales 9/86 frontend + 18/230 backend,
  tsc limpio en ambos, build 7.21s

## Review

La revisión nativa de Gentle AI NO pudo completarse por un defecto del
entorno (no del candidato): cada `review start` devuelve un consent binding
YA expirado (`consent-binding-expired`, TTL 10 min) sin importar cuán rápido
se responda — 4 intentos (3 START + 1 answer-consent), siempre
`lineage_created: false`, `native_invocation_attempted: false`, sin mutación.
El verificador independiente R1-R4 (review-readability/risk/reliability/
resilience) está gatingado por el mismo linaje ausente (`no current
controller-owned candidate view lineage binding`), así que el fallback tampoco
puede correr. Estado por contrato: review `unknown` (nunca `closed`).
Reintentar en otra sesión; el trabajo queda verde y commiteado.

## Delivery (2026-10-09)

- Issue **#8** (`status:approved`) → PR **#10** `feat/chat-intake` → `main`,
  CI verde (Backend + Frontend + GitGuardian), **MERGED** `c29728bb`.
- Stacked sobre el PR **#7** (ci-quality-gates, mergeado primero como
  `0caee7c8` para traer el workflow de CI a `main`).
- **Deploy verificado en producción**: contenedor Hetzner recreado,
  `listening on :8091 (production)`, healthcheck `healthy`,
  `customer_profile` creada por `migrate()` sobre la BD real, `integrity_check`
  `ok`, datos intactos (1 referrer, 2 customers). Flujo real de usuario vía
  Vercel → túnel → Hetzner: `POST /api/referrer/validate` con el código real
  `1906432239` → `{valid:true, Hernan Arango Cortes}`.
- Commits: `f3937e11` (backend intake), `dfbd3e0b` (frontend intake),
  `ca3365f9` + `b3682473` (docs), `c71c9666` (db:pull-prod).

## Evidence (commits per task)

Nota: los archivos `backend/src/routes/assistant.ts` (T1+T2) y
`frontend/.../ChatWidget.tsx` + `types.ts` + `index.ts` (T3+T4) contienen
cambios acoplados de dos tareas cada uno — commits por unidad de backend y de
frontend para que cada commit quede con typecheck y suite verdes:

- Backend (T1+T2): feat(backend): add intake profile and personalize assistant
  prompt
- Frontend (T3+T4): feat(frontend): single chat button with 5-step intake and
  assessment card
- Docs: docs(odd): record chat-intake feature

## Decisions

- Intake determinista (no LLM): las respuestas son estructuradas y se
  persisten con un solo POST; el LLM solo las consume ya armadas.
- Nombre/email/teléfono NO se repiten en el intake (ya los pide el registro);
  el intake empieza en edad/sexo.
- El wizard de 95 síntomas no se modifica: solo cambia cómo se abre.
- Rama reapilada sobre `feat/ci-quality-gates` (PR #7): aporta
  `frontend/tsconfig.json` + typecheck estricto + workflow de CI sin lo cual
  T3/T4 no podían cerrar con `tsc` limpio.
- `[ASSESSMENT]` repetido en un mensaje: la primera tarjeta se renderiza, los
  repetidos se strippingan (nunca se filtra el literal); texto persistido
  intacto (contrato append-only, espejo de VIDEO).
- Sin handler `onOpenAssessment` la tarjeta se renderiza deshabilitada
  (compatibilidad con call sites que no lo pasen).
