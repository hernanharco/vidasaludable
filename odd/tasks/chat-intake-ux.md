# Feature: chat-intake-ux (CTA al chat + cuestionario usable + saludo de dolencias)

Objetivo: que el CTA del hero lleve al chat, que el cuestionario de 5 pasos se
vea y se use bien en escritorio (Eliana se quedó sin avanzar), y que al
terminarlo el agente pregunte sus dolencias con tono amigable.
Rama: `feat/chat-intake-ux` (desde `origin/main`). Estrategia de entrega:
`ask-on-risk` (pronóstico < 400 líneas). Runner: `pnpm --dir frontend test`,
`pnpm --dir frontend typecheck`, `pnpm --dir frontend build`.

## Specs

### S1 — El botón del hero abre el chat

> "quiero que este boton
> `<a href="#booking" class="inline-flex items-center justify-center px-8 py-4 bg-white text-emerald-900 font-semibold tracking-wide text-sm hover:bg-emerald-50 transition-all group rounded-full shadow-lg shadow-emerald-900/30">Comienza tu plan preventivo<svg .../></a>`
> lleve a https://vidasaludable.rincom.es/chat"

El enlace "Comienza tu plan preventivo" del `Hero` apunta a
`https://vidasaludable.rincom.es/chat` (mismo texto, mismas clases, mismo
icono; solo cambia el `href`). Comprobación: test que renderiza `Hero` y
afirma el `href` exacto.

### S2 — El cuestionario se ve completo en escritorio (sin hueco en blanco)

> "el cuestionario en chat no esta correcto hay cosas incoherente y no deja
> avanzar queda la vista en blanco"

Reproducción (Playwright, 5 viewports, 2026-10-15): en 1440×900 el paso 1 se
ve como una franja de formulario arriba, ~700px de fondo casi blanco en el
medio y "Siguiente" abajo, anclado al fondo del panel. En producción el
cliente `elinan19881988@gmail.com` (customers.id=4, alta 2026-10-14) quedó
registrado con `customer_profile = null` y `conversations = 0`: nunca cerró
este cuestionario.

Comprobación: el contenido va en una columna acotada y centrada
(`max-w-lg mx-auto`), el botón queda junto al formulario (sin `mt-auto` que
lo empuje al fondo del viewport) y todo el paso es visible sin scroll en
1440×900 y 1024×640.

### S3 — Se avisa qué falta para poder avanzar

> "no deja avanzar"

Hoy "Siguiente" queda deshabilitado (`disabled:opacity-50`) sin decir por qué:
hay que escribir la edad **y** clickear el chip de sexo (paso 1), elegir el
objetivo (2), dieta + actividad (3), sueño + estrés (4).

Comprobación: mientras el paso actual esté incompleto se muestra un mensaje
visible (cerca del botón) con lo que falta; desaparece al completarlo. El
paso 5 no exige nada, así que no muestra aviso. Test por paso.

### S4 — Textos incoherentes del cuestionario

> "hay cosas incoherente"

Alcance concreto (lo observado en la reproducción):

1. Los chips de sexo dicen `M` y `F` sin explicar. Pasan a etiquetas
   **"Mujer" / "Hombre"** guardando igual `F` / `M` (el contrato de wire
   `POST /api/assistant/profile` no cambia).
2. El paso 2 escribe **"Objetivo principal" dos veces** (el `<h5>` y la label
   del grupo de chips). Queda una sola visible.
3. La regla "Edad entre 1 y 120 años." aparece debajo del grupo **Sexo**;
   queda debajo del campo de edad, donde corresponde.

Comprobación: tests que afirman las etiquetas nuevas, el valor de wire
`sex: "F"`/`"M"` sin cambios, y que "Objetivo principal" se ve una sola vez.

### S5 — Al terminar, el agente pregunta las dolencias (tono amigable)

> "cuando se termine el cuestionario. el agente debe informar que cuales son
> sus dolencias que le gustaria conversar. manejar un tono amigable y
> compresible"

Decisión del usuario (2026-10-15): **"Mensaje fijo con su perfil"** — el
primer mensaje del agente al cerrar el cuestionario es un texto fijo del
frontend que usa la ficha recién guardada (edad y objetivo), sin llamado a la
IA, sin latencia ni fallo posible. Pregunta explícitamente qué dolencias o
molestias le gustaría conversar, en español claro y amable.

Comprobación: test de `ChatSession` — al completar el cuestionario, el primer
burbujeo del agente contiene la pregunta de dolencias y los datos de la ficha;
sin llamado a `/api/assistant/ask` para ese mensaje.

## Tasks

| # | Task | S# | Ruta | Estado | Evidencia |
|---|------|----|------|--------|-----------|
| T1 | Hero: `href="https://vidasaludable.rincom.es/chat"` + test RED | S1 | inline | done | RED observado (`href="#booking"`) → GREEN: `frontend/test/HeroCta.test.tsx` 2/2 en verde. Commit `07156a2b`. |
| T2 | ChatIntake: columna acotada/centrada, botón junto al formulario, aviso de qué falta, textos (Mujer/Hombre, label duplicada, hint de edad) + tests RED | S2-S4 | inline | done | RED: 12 tests en rojo (6 pre-existentes + 6 nuevos) → GREEN: 13/13 en `frontend/test/ChatIntake.test.tsx`. Playwright 1440×900: columna centrada de 512px, "Siguiente" en y=590 (antes y=844), hint ámbar visible, chips "Mujer/Hombre". Commit `da6f3533`. |
| T3 | ChatSession: saludo fijo con perfil que pregunta dolencias + test RED | S5 | inline | done | RED observado (saludo genérico viejo) → GREEN: 14/14 en `frontend/test/ChatIntake.test.tsx`. E2E Playwright local: al cerrar el cuestionario el agente abre con "¡Hola! Ya guardé tu ficha inicial (38 años · objetivo Sueño). ¿Qué dolencias o molestias te gustaría conversar conmigo?…", sin llamado a `/assistant/ask`. Commit `da6f3533`. |
| T4 | Cierre: suite frontend completa, typecheck y build | S1-S5 | inline | done | `pnpm test`: 23 archivos / **171 tests en verde**; `pnpm typecheck` sin errores; `pnpm build` ✓ (9.8s). E2E Playwright local completo (código → registro → 5 pasos → chat → respuesta de Gemini). |
| T5 | Cierre ODD: doc + espejo Engram + assess RDD | S1-S5 | inline | in_progress | |

## Log

- L1 (petición original, verbatim): "1. quiero que este boton
  `<a href="#booking" ...>Comienza tu plan preventivo...</a>` lleve a
  https://vidasaludable.rincom.es/chat

  2. el cuestionario en chat no esta correcto hay cosas incoherente y no deja
  avanzar queda la vista en blanco
  /tmp/pi-clipboard-74dcc6f6-8c66-401e-9695-7f7608ee426a.png

  elinan19881988 intento conversar con el agente pero este no avanzo.

  cuando se termine el cuestionario. el agente debe informar que cuales son
  sus dolencias que le gustaria conversar. manejar un tono amigable y
  compresible"
- L2 (2026-10-15, decisión): pantalla afectada → "Sí, esa misma pantalla"
  (el cuestionario de 5 pasos en escritorio). Saludo → "Mensaje fijo con su
  perfil".
- L3 (2026-10-15, evidencia): reproducción local completa con Playwright
  (código 1906432239 → registro → 5 pasos → chat → respuesta del agente y
  chequeeo de 95 síntomas) en 320/390/768/1024/1440: el flujo funciona, pero
  el paso 1 en escritorio deja ~700px de hueco y "Siguiente" deshabilitado
  sin aviso. Producción (ssh hetzner-ts, solo lectura): `customers.id=4`
  Eliana, alta 2026-10-14, `customer_profile` vacío, `conversations` vacío,
  BD sin escrituras desde su alta; el contenedor `vidasaludable-api-1` sin
  errores en logs. El backend, las rutas `/assistant/profile` y el
  questionnaire de 95 síntomas responden bien.
- L4 (2026-10-15, cierre T1-T4): commits `07156a2b` (S1) y `da6f3533`
  (S2-S5) en la rama `feat/chat-intake-ux`. RED observado antes de cada
  implementación (1 fallo en S1; 12 en S2-S4; 1 en S5) y GREEN final:
  171/171 tests, `typecheck` y `build` limpios. E2E Playwright local: el
  cuestionario se ve centrado con el aviso de qué falta y, al cerrarlo, el
  agente abre con la pregunta de dolencias usando la ficha guardada.
  Pendiente: push / PR son decisión del usuario. **Risk: none** — sin datos
  almacenados ni seguridad; el contrato de wire `sex: F|M` se preserva y lo
  cubre un test; el único destino público que cambia (CTA del hero) es el
  pedido.
