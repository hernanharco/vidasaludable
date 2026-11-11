# Feature: multi-conversación estilo Gemini con memoria global

Estado: **en curso** (2026-11-11). El usuario aprobó el orden: parte 1
(access-code-once, entregada en `c57893c3`) → parte 2 (este documento).
Diseño base recomendado por el orquestador y aceptado: sidebar/drawer estilo
Gemini, títulos autogenerados, memoria global existente intacta.

## Specs

> S1 — "tengo otra pregunta a nivel de diseño y experiencia creo que es bueno
> tener un diseño estilo gemini por si la persona quiere tener en varios
> lugares temas en particulares o como podriamos manejar esto. ejemplo tener
> en una conversacion algo de dolor de espalda y en otro lado de pronto
> pregunta algo de algun familiar."

El usuario puede mantener varias conversaciones independientes, cada una con
un tema particular (p. ej. dolor de espalda en una; una pregunta sobre un
familiar en otra), creando, listando, abriendo y cambiando entre ellas desde
la UI.

> S2 — "pero que la memoria si sea global."

La memoria del cliente es global: el resumen de lo aprendido en CUALQUIER
conversación se inyecta en todas las demás. No hay memoria aislada por tema.

> S3 — recomendación de diseño aceptada ("Primero parte 1, luego parte 2"):
> sidebar estilo Gemini con botón de menú en `ChatHeader` → drawer con lista
> de conversaciones + botón "Nueva conversación"; títulos autogenerados del
> primer mensaje del usuario; "Nueva conversación" limpia solo
> `vr_conversation_id` + mensajes, sin tocar identidad/consentimiento/
> atribución; en mobile el sidebar es drawer deslizante.

## Facts del mapa (explorer, 2026-11-11)

- DB: `conversations` (id, customer_id FK indexed, created_at) ya soporta N
  por cliente; `messages` por conversación ordenados por `id`. **Falta**
  `title` y `updated_at`.
- Frontend guarda UN solo `vr_conversation_id` (`ChatSession.tsx:105-108`);
  `messages` es estado React; `loadHistory` restaura vía
  `GET /api/assistant/history?conversation_id&customer_id`.
- `/ask` crea conversación solo si no se envía una (`assistant.ts:266-272`).
- **Memoria global YA existe**: `customer_memories` (1 fila/cliente,
  resumen cada 8 mensajes, `memoryService`) inyectada en TODAS las
  conversaciones vía `memoryBlock` (`prompt.ts:216-230, 411-414`); historial
  enviado a Gemini = últimos 10 mensajes de la conversación actual.
- No existe endpoint de lista/creación de conversaciones para el cliente
  (solo `GET /conversations` admin). No hay sidebar en el chat del cliente
  (`ChatHeader` solo título + cerrar).
- Riesgo conocido: el assessment y el gate comparten estado; ningún cambio
  de esta feature debe tocar `vr_referrer_*` ni `vr_customer_id`.

## Tasks

- [x] T1 — Backend: migración `conversations.title` (nullable) +
  `updated_at`; `GET /assistant/conversations?customer_id=N` (lista con
  title, updated_at, snippet) y `POST /assistant/conversations` (crea vacía
  para el cliente); `/ask` refresca `updated_at` del turno. Tests de ruta +
  contrato. Commit `feat(backend)` → **`6e0abdde`** (8 tests nuevos, RED
  8/8 observado; suite 320/320 + tsc OK; spot check del orquestador en
  verde). Contratos: GET → `{conversations:[{id,customer_id,title,updated_at,created_at,snippet}]}`
  (400 customer_id inválido / 404 customer no encontrado); POST `{customer_id}`
  → `{conversation_id}`; título = primer mensaje, tope 50 chars, solo
  mientras NULL; `snippet` = último mensaje, tope 80 + `…`.
- [x] T2 — Frontend: sidebar/drawer de conversaciones en `/chat`
  (`ChatHeader` menú → panel), "Nueva conversación" (limpia
  `vr_conversation_id` + mensajes, no toca identidad), abrir conversación
  (swap `conversationId` + `loadHistory`), título autogenerado del primer
  mensaje. Tests de flujo. Commit `feat(chat)` → **evidencia en L4**.
  Detalle: el id creado por POST se mantiene en estado (no solo en storage)
  para que el primer `/ask` use esa conversación y no orqueste una fila
  vacía; al re-seleccionar la actual solo cierra el panel.
- [ ] T3 — Cierre: docs/help si aplica, suite completa, deploy + verificación
  en prod, evidencia en este documento (L de Log con commits).

## Log

- **L1** (2026-11-11, verbatim): "tengo otra pregunta a nivel de diseño y
  experiencia creo que es bueno tener un diseño estilo gemini por si la
  persona quiere tener en varios lugares temas en particulares o como
  podriamos manejar esto. ejemplo tener en una conversacion algo de dolor de
  espalda y en otro lado de pronto pregunta algo de algun familiar. pero que
  la memoria si sea global. que me puedes recomendar o como verias esta parte
  que me puedes recomendar. porque aqui cambia UI y AX"
- **L2** (2026-11-11, decisión del usuario vía ask_user_question): alcance
  "Chat + assessment" para la parte 1; orden "Primero parte 1, luego parte 2".
- **L3** (2026-11-11, T1): worker reportó riesgo de migración — SQLite
  rechaza `ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP` en tablas no vacías y
  `migrate.ts` tragaba errores ALTER; resuelto con default constante `''` +
  backfill desde `created_at` (verificado con tabla legado no vacía). Revisar
  en T3 la migración contra la BD real de prod (`/opt/vidasaludable/data/dev.sqlite`).
  `updated_at` mezcla formato legado `YYYY-MM-DD HH:MM:SS` (backfill) con
  ISO-8601 (escrituras nuevas); orden lexicográfico correcto (ambos UTC).
- **L4** (2026-11-11, T2): worker implementó el sidebar test-first (RED
  4/5 → GREEN 7/7). Decisiones: el id de "Nueva conversación" vive en
  estado + storage en el primer turno (evita crear dos filas); fallback de
  título = excerpt del primer mensaje → snippet → "Nueva conversación";
  drawer con Escape/Tab-trap/scroll-lock estilo AdminLayout; el botón de
  menú solo existe en fase chat (gates/intake sin cambios). Suite frontend
  256/257 (único fallo = timeout pre-existente de ChatIntake) + tsc OK,
  spot check del orquestador en verde.
