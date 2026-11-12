# Feature: tamizaje presencial opcional + imágenes Cloudinary + solicitud de cita

Estado: **iniciada** (2026-11-11). Alcance decidido por el usuario en 4
preguntas (L2). Imagen de referencia: reporte RENPHO (báscula de composición
corporal) — peso 77.85 kg, IMC 26.3, grasa 26.9% alto, visceral 9, masa
muscular 54.10 kg, músculo esquelético bajo promedio, edad metabólica 39,
BMR 1599 kcal, agua 52.8%, proteína 13.00 kg, hueso 2.80 kg.

## Specs

> S1 — "esta informacion se hace de forma presencial, manejando la tanita
> como podriamos implementar el uso de esta informacion pero que no sea
> obligatorio hacerlo pero si la persona desea hacerse un tamizaje que se
> puede solicitar una cita. que podriamos hacer."

El uso del dato de la Tanita es **opcional y nunca bloqueante**: sin
registros el sistema se comporta igual. Con registros, se inyecta como
bloque opcional en el prompt del agente. Quien desee un tamizaje puede
**solicitar una cita**.

> S2 — "poder guardar esta imagenes en donde se pueda tener un historial de
> esto, utilicemos claudinary para el uso de imagenes"

Historial de imágenes por cliente en Cloudinary (`public_id`/`secure_url`
en la BD, nunca binarios en SQLite), visible en la ficha del cliente del
admin.

> S3 — Decisiones del usuario (ask_user_question, 2026-11-11):
> registro "Admin + chat del cliente"; cita "Landing + CRM + chat";
> dato "Inyectar en el agente"; Cloudinary "Sí, ya tengo credenciales".

## Diseño (aceptado)

**Tablas nuevas** (migración en `migrate.ts` al estilo existente):
- `body_metrics`: id, customer_id FK, measured_at, weight_kg, bmi,
  body_fat_pct, fat_mass_kg, subcutaneous_fat_pct, visceral_fat,
  muscle_pct, muscle_mass_kg, skeletal_muscle_pct, skeletal_muscle_mass_kg,
  bone_pct, bone_mass_kg, fat_free_mass_kg, metabolic_age, bmr_kcal,
  water_pct, protein_pct, source (RENPHO|manual), notes, created_at.
  (Campos REAL nullable — registro parcial es válido.)
- `customer_images`: id, customer_id FK, kind (tamizaje|evolucion|otro),
  cloudinary_public_id, cloudinary_secure_url, taken_at (fecha del
  reporte), uploaded_by (customer|admin), notes, created_at.
- `appointment_requests`: id, customer_id FK NULL, name/phone/email NULL
  (para el form público del landing), reason, status
  (pendiente|contactada|agendada|cancelada) default pendiente, notes,
  created_at, updated_at.

**Cloudinary**: `backend/src/services/cloudinaryService.ts` con factory
`createCloudinaryClient(env)` + DI por `BuildAppDeps` (patrón geminiClient).
Upload **server-side proxy**: el cliente envía base64 en JSON a nuestro
endpoint (gate propio) → el backend firma (SHA-1 de params+secret, crypto
node) y hace POST a `https://api.cloudinary.com/v1_1/<cloud>/image/upload`
→ devuelve y registra `public_id`/`secure_url`. Env:
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
(opcional `CLOUDINARY_FOLDER`). Límite de carga: 8 MB (rechazar 413/400).
Tests inyectan un fake (como geminiClient) — no necesitan credenciales.

**Endpoints**:
- Customer (consent gate 401 CONSENT_REQUIRED como `/ask`, por ser PII de
  salud): `POST /assistant/images/sign` NO — con proxy no hace falta sign;
  `POST /assistant/images` (base64, kind, taken_at, notes) → sube + registra;
  `GET /assistant/images` (lista del customer); `POST /assistant/body-metrics`
  (upsert por fecha) + `GET /assistant/body-metrics`.
- Customer sin consent (solo chequeo 400/404 como `/conversations`):
  `POST /assistant/appointments` (reason, opcional contactos) → status
  pendiente. `GET /assistant/appointments` (los suyos).
- Público (landing Booking): `POST /appointments` {name, phone, email?,
  reason} → customer_id NULL. Sin auth: validar formato, sin campos libres
  gigantes; documentar riesgo de spam (rate-limit futuro).
- Admin (guard automático `/admin/*`): `GET /admin/customers/:id/images`,
  `POST /admin/customers/:id/images` (upload + registro, uploaded_by=admin),
  `GET/POST /admin/customers/:id/body-metrics`, `GET /admin/appointments`,
  `PATCH /admin/appointments/:id` {status, notes}.
- `DELETE /admin/customers/:id`: sumar body_metrics, customer_images
  (Cloudinary destroy best-effort, nunca bloquear el delete), y
  appointment_requests a la transacción existente.

**Prompt (S3 "Inyectar en el agente")**: `bodyMetricsBlock` en
`agent/prompt.ts` (último registro de body_metrics, opcional, vacío si no
hay) inyectado después de memoryBlock; instrucción al agente: usar como
insumo de estilo de vida, nunca como diagnóstico (la propia nota RENPHO dice
que no sustituye equipos médicos). Marcador `[CITA]`: el agente lo emite
cuando el usuario pregunta por tamizaje/cita (instrucción en prompt como
`[ASSESSMENT]`); el frontend renderiza card de botón → dialog de confirmación
→ `POST /assistant/appointments`.

**UI**:
- Admin ficha (`CustomerDetailPage`): secciones nuevas — "Tamizaje e
  imágenes" (grid de miniaturas + fecha + lightbox + subida con
  input file → base64 → endpoint) y "Métricas corporales" (tabla del último
  registro + alta rápida) y "Citas" (lista + cambiar estado).
- Admin landing: form `Booking.tsx` deja de ser fake → POST `/appointments`
  real con estados de envío/error.
- Chat: botón adjuntar en `ChatInput` (file → base64 → `POST
  /assistant/images`, toast de éxito/error); card `[CITA]` en
  `ChatMessages` (patrón AssessmentCard) → dialog → POST
  `/assistant/appointments`.

## Constraints

- NO tocar contratos `vr_referrer_*`, `vr_customer_id`, `vr_conversation_id`
  ni los flujos de gate/consentimiento existentes (agregar branches, no
  cambiar los actuales).
- Nada de binarios en SQLite; URLs de Cloudinary solamente.
- Borrado de cliente sin dependientes huérfanos (revisar
  customerService.delete).
- Credenciales Cloudinary: el usuario YA las tiene — se agregan al `.env`
  de Hetzner en T5 (pedido al usuario en ese momento); los tests usan fakes.

## Tasks

- [x] T1 — Backend core: 3 tablas + migración; `cloudinaryService` (DI,
  firma SHA-1, upload proxy con fake inyectable); endpoints admin (images,
  body-metrics, appointments CRUD-lite); `DELETE /customers/:id` con
  dependents. Tests. Commit `feat(backend)` → **`099dc5be`** (RED 20/20
  observado; 29 tests nuevos; suite 349/349 + tsc OK, spot check del
  orquestador en verde; tests sin credenciales CLOUDINARY_*). Contratos:
  GET/POST `/admin/customers/:id/images` (201 {image} | 400 kind/data |
  413 >8MB | 500 not configured | 502 upload failed | 404),
  GET/POST `/admin/customers/:id/body-metrics` (upsert parcial por
  measured_at, 17 campos snake_case), GET `/admin/appointments`, PATCH
  `/admin/appointments/:id` (estados pendiente|contactada|agendada|cancelada),
  DELETE customer borra las 3 tablas (destroy Cloudinary best-effort post-commit).
  Firma Cloudinary: params ordenados alfabéticamente `k=v&...` + api_secret
  sin separador → SHA-1; vectors fijados en tests. Pendiente T5: probar
  upload real con credenciales + documentar CLOUDINARY_* en .env.example.
- [x] T2 — Backend customer-facing: endpoints `/assistant/images`,
  `/assistant/body-metrics` (consent 401) y `/assistant/appointments`
  (400/404) + endpoint público `POST /appointments`; `bodyMetricsBlock` +
  instrucción `[CITA]` en prompt. Tests. Commit `feat(backend)` →
  **`b200a9ae`** (RED 23/23 observado; 26 tests nuevos; suite 375/375 +
  tsc OK, spot check en verde). Detalle: lógica admin/cliente extraída a
  servicios compartidos `imageService`/`bodyMetricService` (contratos admin
  byte-idénticos, tests de T1 verdes); bloque va después de memoryBlock;
  rate-limit público 5/10min por IP → 429 (in-memory); [CITA] documentado
  en HARD_LIMIT regla 9 + GUIDED_FLOW paso 4.
- **L5** (2026-11-11, T5 + incidente de deploy): el build de producción
  FALLÓ en `Dockerfile.prod:7` con "At least one invalid signature was
  encountered" en los tres InRelease de Debian — el camino **IPv6 del
  host Hetzner corrompe las descargas de apt** (el mismo contenido por
  IPv4 verifica y baja limpio; reloj y NTP ok). Fix: `667e18df` escribe
  `/etc/apt/apt.conf.d/99force-ipv4` antes del primer apt. **Hallazgo
  aparte (no tocado):** el webhook del servidor
  (`/opt/deploy-webhook/webhook.sh`) corre `docker compose up --build`
  con `capture_output=True` SIN chequear returncode → logueó "Deploy
  complete" en 7 segundos con el build roto; además sus entregas
  previas a GitHub salían "Unknown error". Afecta también a
  riderDefensa — pendiente de decisión del usuario.
- **L6** (2026-11-11, API Cloudinary): el destroy correcto es
  `POST /v1_1/<cloud>/image/destroy` (con resource type); `/v1_1/<cloud>/destroy`
  devuelve la página 404 de marketing de cloudinary.com. Tras borrar, la
  URL de `res.cloudinary.com` puede seguir devolviendo 200 por caché de
  Cloudflare (`immutable, max-age=2592000`); confirmar con un segundo
  destroy → `{"result":"not found"}`.
- [x] T3 — Admin UI: secciones en CustomerDetailPage (imágenes + lightbox +
  subida, métricas, citas con estados) + api.ts + form Booking real.
  Tests. Commit `feat(admin)` → **`58946492`** (RED 11/11 observado; 11
  tests nuevos; suite frontend 268/268 + tsc OK, spot check en verde).
  Detalle: componente `CustomerScreening` autocontenido; Booking ganó campo
  Teléfono (obligatorio en el backend) y la fecha preferida viaja dentro
  del reason (el endpoint público no tiene columna de fecha); diálogos
  Radix emiten warnings pre-existentes de consola (informativos).
- [x] T4 — Chat UI: botón adjuntar en ChatInput, card `[CITA]` en
  ChatMessages. Tests. Commit `feat(chat)` → **`8017cc48`** (RED 14/16
  observado; 16 tests nuevos en ChatTamizaje.test.tsx; suite frontend
  284/284 + tsc OK, spot check en verde). Detalle: POSTs subidos a
  ChatSession (paridad byte-a-byte con el 401 de /ask); marcador vía split
  único con dedupe de primera aparición; warning de refs en DialogOverlay
  es pre-existente (informativo).
- [x] T5 — Cierre: suites completas (backend 320+ / frontend 256+),
  pedir credenciales CLOUDINARY_* para Hetzner, deploy + verificación E2E
  (subida real de una imagen de prueba, historial visible, cita desde
  landing y desde chat), evidencia en este Log.
  **Hecho (L5)**: credenciales en `/opt/vidasaludable/.env` (respaldo
  `.env.bak-cloudinary-20261111-223355`); commits `099dc5be`, `b200a9ae`,
  `58946492`, `8017cc48`, `667e18df` pushados y desplegados; suites finales
  backend **375/375** + frontend **284/284** + tsc (spot checks por tarea);
  E2E: 3 vars CLOUDINARY en el contenedor, 3 tablas creadas con integrity
  ok, health 200, **subida real a Cloudinary** (public_id
  `vidasaludable/tamizaje/swmpinokfpraztvbuncg`, destroy ok/not-found — la
  copia 200 restante es caché de Cloudflare del píxel 1×1), `POST
  /appointments` público → **201** (fila de prueba borrada), bundle
  `index-DDa-ITaW.js` con "Adjuntar imagen" + "Solicitar cita para
  tamizaje".

## Log

- **L1** (2026-11-11, verbatim): "esta informacion se hace de forma
  presencial, manejando la tanita como podriamos implementar el uso de esta
  informacion pero que no sea obligatorio hacerlo pero si la persona desea
  hacerse un tamizaje que se puede solicitar una cita. que podriamos hacer.
  y otro cosa poder guardar estas imagenes en donde se pueda tener un
  historial de esto, utilicemos claudinary para el uso de imagenes"
- **L2** (2026-11-11, decisiones vía ask_user_question): 1) registro =
  "Admin + chat del cliente"; 2) cita = "Landing + CRM + chat"; 3) uso del
  dato = "Inyectar en el agente"; 4) Cloudinary = "Sí, ya tengo
  credenciales".

---

## T6 — Descubrimiento del tamizaje (2026-11-11)

> **L7** (verbatim): "como se da cuenta el usuario que puede tener un
> tamizaje?" — decisión vía ask_user_question: los TRES canales
> (Landing + Chat proactivo + Resultados del assessment).

Tareas:
- [x] T6a — Landing: opción `tamizaje` ("Tamizaje corporal (Tanita)") en
  REASON_LABELS + select del form de Booking, y copy en la sección que
  presente el servicio (qué es, qué mide con la Tanita, presencial y
  opcional, sin compromiso). Commit `feat(landing)`.
- [x] T6b — Chat proactivo: instrucción en `agent/prompt.ts` para que el
  agente OFREZCA el tamizaje cuando el tema lo amerite (peso, grasa,
  composición corporal, bajar de peso, objetivos corporales) emitiendo
  `[CITA]` — sin ser insistentente, una oferta por tema. Commit
  `feat(backend)`.
- [x] T6c — Assessment results: card contextual en la fase de resultados
  ("¿Querés medir tu composición corporal en persona? → Solicitar cita").
  Con `vr_customer_id` guardado → reutiliza el diálogo de cita de chat
  (extraer CitaCard a componente compartido); sin identidad → enlace a
  `#booking` del landing (donde T6a ya ofrece el motivo tamizaje). Commit
  `feat(chat)`.
- [x] T6d — Cierre: **Hecho (L8)**. Commits `c0b6dfa4` (landing),
  `463dd3ec` (prompt regla 10), `d84dfea2` (CTA assessment + componente
  compartido). Suites: backend **377/377**, frontend **291/291**, tsc
  limpio en ambos (spot check del orquestador). RED observado: 3/3 + 2/2 +
  6/6. Copy elegido: opción "Tamizaje corporal (Tanita)" primera en el
  select; regla 10 = oferta máx. una vez por tema, nunca venta forzada;
  CTA = "¿Querés medir tu composición corporal en persona?" → diálogo con
  identidad / enlace a #booking sin ella (clave corrupta degrada al
  enlace). Pendiente E2E de deploy (ver L9).
- **L9** (2026-11-11, T6 E2E en prod): push `67a5bf96` → webhook con build
  exitoso (fix IPv4 en vigor). Verificado: regla 10 en
  `/app/dist/agent/prompt.js` del contenedor; bundle `index-DItN56_s.js`
  con "Tamizaje corporal (Tanita)" y "composición corporal en persona" (el
  shell HTML no las muestra porque el copy vive en el bundle SPA).
  **Feature completa.** Pendiente humano: vistazo manual al diálogo anidado
  en browser y valorar el tono de la oferta proactiva del agente.
