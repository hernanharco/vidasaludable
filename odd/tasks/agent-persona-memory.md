# Feature: agent-persona-memory

Da personalidad cercana/conversacional al agente del chat y memoria a largo plazo por cliente
en la propia BD del producto (SQLite), con Engram como memoria de desarrollo del orquestador.

Decisiones del usuario: memoria del chatbot en SQLite + Engram como memoria de desarrollo
("Ambos"); personalidad "Cercana y conversacional".

## Specs

- **S1 (memoria del chatbot)** — Usuario: "pregunta en la parte del agente estamos utilizando
  alguna memoria. me gustaria utilizar engram para esta parte". Decisión: "Ambos" → el agente
  gana memoria persistente POR CLIENTE en la BD del producto (tabla nueva, resumen de las
  conversaciones anteriores) que se inyecta en el system prompt; una falla del resumen nunca
  rompe ni retarda la respuesta del chat. Cubierto por el consentimiento vigente, punto 3(b)
  "mantener la continuidad de la conversación" (sin bump de versión).
- **S2 (Engram como memoria de desarrollo)** — Decisión "Ambos": Engram es la memoria
  persistente DEL ORQUESTADOR sobre este agente (decisiones, gotchas, patrones); no es
  dependencia de runtime del backend de producción. Evidencia fuera del repo (por diseño):
  observaciones Engram 2485 (apertura de la feature), 2486 (gotcha migrate split ';'),
  2487 (diseño de la memoria). Verificado además por el verificador: `grep -rin engram
  backend/src` → 0 hits (Engram NO es dependencia de runtime).
- **S3 (personalidad)** — Usuario: "darle un personalidad al agente". Decisión: "Cercana y
  conversacional" → el agente charla (tuteo, frases cortas, cero aberturas mecánicas tipo
  "Como asistente…"), reconoce lo que el usuario siente antes de sugerir, máximo 1 pregunta
  de seguimiento por respuesta. El HARD_LIMIT legal no se toca.
- **S4 (no empujar productos)** — Usuario: "sin importar que se le escribe siempre esta
  enviando los productos". El agente NO debe recomendar producto por recomendando: solo
  sugiere cuando el tema lo pide y encaja con lo que el usuario preguntó; saludos, dudas
  generales o despedidas reciben respuesta conversacional, sin lista de productos.
- **S5 (fluidez)** — Usuario: "se siente muy robotico" / "no se siente con fluidez
  conversando". El ritmo se adapta al mensaje del usuario (escribe poco → respuesta corta);
  el ritual fijo de "abre siempre con 2-3 preguntas" queda reservado al primer contacto
  post-intake (los saludos y la charla general ya no lo repiten); la memoria del resumen
  corre fuera del camino de la petición para no sumar latencia; la temperatura sube de 0.3
  a 0.6 para estilo conversacional (el guard determinista legal y el filtro de refs contra
  catálogo siguen cubriendo el riesgo).

## Tasks

- **T1 (S3-S5)** — Personalidad y fluidez: bloque PERSONA + revisión de GUIDED_FLOW en
  `backend/src/agent/prompt.ts`; constante `TEMPERATURE` usada por `backend/src/agent/gemini.ts`.
  Tests primero (RED→GREEN) en `backend/test/persona.test.ts`. Ruta: inline. Commit: `5cd393e1`.
- **T2 (S1)** — Memoria por cliente: tabla `customer_memories` (schema.ts + migrate.ts),
  `memoryService`, disparo de resumen en `backend/src/routes/assistant.ts` (cada 8 mensajes,
  fallo de Gemini tragado sin afectar la respuesta), bloque `memoryBlock` inyectado en
  `buildSystemPrompt`. Tests primero. Ruta: inline (T1 y T2 comparten prompt.ts, no hay
  superficies disjuntas para writers paralelos). Commit: `b356d15b`.
- **T3 (S2)** — Engram: guardar en memoria persistente las decisiones/gotchas de la feature
  (mirror de este doc + descubrimientos). Ruta: memoria del orquestador.
- **T4 (S1-S5)** — Verificación independiente (riesgo alto: migración de BD, ítem 1), docs
  que describan el agente si aplican, y work-unit commits con tests y docs junto al código.
  Commits: `5cd393e1` (T1), `b356d15b` (T2), `c07e8149` (fix follow-up de verificación), doc.

## Log

- **L1** (petición original, verbatim): "pregunta en la parte del agente estamos utilizando
  alguna memoria. me gustaria utilizar engram para esta parte y darle un personalidad al
  agente. se siente muy robotico y sin importar que se le escribe siempre esta enviando los
  productos no se siente con fluidez conversando"
- **L2** — Decisiones del usuario vía formulario: memoria = "Ambos" (SQLite para el chatbot +
  Engram como memoria de desarrollo); personalidad = "Cercana y conversacional".
- **L3** — Evidencia del estado previo (exploración inline): memoria solo dentro de la
  conversación (`loadHistory` → últimos 10 mensajes, `prompt.ts` `slice(-10)`), sin memoria
  entre conversaciones; system prompt 100% reglas legales, `temperature: 0.3`
  (`gemini.ts:164`), GUIDED_FLOW obliga a abrir con 2-3 preguntas y a dar recomendaciones
  siempre. Baseline: 26 archivos / 270 tests verdes en `main`.
- **L4** — T1 + T2 cerrados en verde en rama `feat/agent-persona-memory`: 29 archivos / 287
  tests verdes + `tsc --noEmit` limpio. Evidencia de diseño (S1): cursor por conversación
  (`up_to_count` + `source_conversation_id`) para que una conversación nueva reinicie el
  contador; el resumen previo se inyecta en el input del summarizer → continuidad sin duplicar
  filas; trigger best-effort (try/catch en la ruta, jamás rompe ni retarda la respuesta).
- **L5** — Verificación independiente (`gentle-ai-verify`, externo, read-only) sobre la rama:
  **sin BLOCKER**; S1/S3/S4/S5 Covered (S2 out-of-repo por diseño); migración idempotente
  (IF NOT EXISTS, único punto de creación, comentarios sin `;`, sin ALTER/DROP nuevos);
  HARD_LIMIT sin un solo hunk; `buildSystemPrompt` backwards-compatible; guard y filtros de
  refs intactos; aislamiento de fallos probado a nivel HTTP; 287 tests + tsc limpio.
  FOLLOW-UP (latencia del resumen await-ado en el camino de la petición) RESUELTO en
  `c07e8149`: trigger fire-and-forget post-respuesta + tests con `vi.waitFor`. NIT (typo
  "mencionon") corregido en el mismo commit. NIT (wording de S5 sobre el ritual de las
  2-3 preguntas) aclarado en este documento: queda reservado al primer contacto post-intake.
