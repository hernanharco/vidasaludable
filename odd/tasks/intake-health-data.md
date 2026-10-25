# Feature: intake-health-data (cuestionario: peso/altura, condiciones, alergias + fix pantalla en blanco)

Objetivo: ampliar el cuestionario de registro con peso, altura, condiciones de
salud y alergias (sumar, no quitar), mejorar etiquetas a lenguaje cotidiano y
eliminar la pantalla en blanco que algunos usuarios ven al terminar el
cuestionario. Rama: `feat/intake-health-data` (desde `main`).

Decisiones del usuario (2026-01): peso/altura opcionales; dieta visible como
"Como de todo (carne, pescado, verduras)" conservando el valor guardado
"Omnívora"; "colon" etiquetado "Problemas de colon"; el bug de pantalla en
blanco ocurre al terminar el cuestionario.

## Specs

### S1 — Peso y altura en el paso 1 (opcionales)

> "peso kg"
> "en el formulario hay que ingresar alturas en mts"

Paso 1 del cuestionario suma dos campos junto a la edad:
- Peso (kg): numérico, opcional; si se completa debe ser 30–300 kg.
  Placeholder "Ej: 70".
- Altura (m): numérico, opcional, en metros aceptando coma o punto decimal
  ("Ej: 1,70"); si se completa debe ser 1,00–2,30 m.
Opcionales: no bloquean "Siguiente". Se envían como `weight` (number kg) y
`height` (number m) en el POST /assistant/profile y se guardan en columnas
nuevas REAL.

### S2 — Dieta en lenguaje cotidiano

> "la parte que dice omnivoro este nombre normalmente no se conoce colocar algo mas normal de conocer"

El chip de dieta se muestra como "Como de todo (carne, pescado, verduras)",
"Vegetariana", "Vegana". El VALOR guardado en BD y en el wire sigue siendo
"Omnívora" (no se rompen datos existentes ni el prompt).

### S3 — Condiciones de salud (nuevo paso, multi-selección)

> "buscar una forma de preguntar si el usuario tiene algunas de estas
> tension
> tiroides
> colon
> diabetes
> hipoglisemia
> fatiga muscular"

Nuevo paso "Salud" (multi-select de chips): "Tensión alta", "Tiroides",
"Problemas de colon", "Diabetes", "Hipoglisemia", "Fatiga muscular", "Ninguna"
(exclusiva: al elegirla se deselecciona todo lo demás y viceversa) y
"Alergias". Se guarda como lista separada por ", " en columna nueva
`conditions` TEXT. Opcional (no bloquea avanzar).

### S4 — Alergias con detalle obligatorio

> "alergia - cuando diga alergia debe escribir alergia a que"

Al marcar el chip "Alergias" aparece un campo de texto "¿Alergia a qué?"
(obligatorio solo en ese caso) que bloquea "Siguiente" hasta escribirse.
Se guarda en columna nueva `allergies` TEXT.

### S5 — El bot recibe los datos nuevos

El bloque PERFIL DEL USUARIO del prompt del agente incluye, cuando existen:
`- Peso: 70 kg · Altura: 1,70 m`, `- Condiciones: ...`, `- Alergias: ...`.
Igual para el contexto del resumen del asesor. Campo ausente/vacío ⇒ no se
renderiza (regla existente de profileBlock).

### S6 — Pantalla en blanco al terminar el cuestionario

> "hay un error en algunos usuarios despues de llenar el formulario se queda la pantalla en blanco no pasa a la parte de escribir con el bot"

Sin ErrorBoundary en el frontend: cualquier error de render deja la app en
blanco. Se agrega un ErrorBoundary con fallback accionable ("Reintentar")
alrededor de la sesión de chat, y la transición cuestionario→chat queda
endurecida (un fallo en el saludo/post-intake no puede dejar fase "chat" sin
contenido renderizable).

### S7 — Fluidez

> "revisemos el formulario que tenemos y mirar de que forma podemos relacionar estas opciones y que quede fluido para llenar. no quitar lo que tenemos aunmentar y mejorar"

Estructura final: 6 pasos — 1) Edad, sexo, peso, altura · 2) Objetivos ·
3) Hábitos · 4) Sueño y estrés · 5) Salud (condiciones/alergias) ·
6) Pregunta abierta. Ningún campo ni paso existente se elimina.

## Tasks

- T1 — Backend: columnas weight/height/conditions/allergies (schema + migrate
  ALTER idempotentes), profileService.upsert/get, POST/GET /assistant/profile.
  Tests backend. commit `feat(profile): intake weight/height/conditions/allergies fields`
- T2 — Backend: profileBlock del prompt del agente y contexto del resumen del
  asesor con los campos nuevos. Tests. commit `feat(agent): expose health fields in profile prompt block`
- T3 — Frontend: ChatIntake — peso/altura (S1), etiqueta dieta (S2), paso
  Salud (S3/S4), 6 pasos (S7). Tests (RED primero). commit `feat(intake): weight, height, health conditions and allergies steps`
- T4 — Frontend: ChatSession — wire de campos nuevos, EMPTY_PROFILE, saludo.
  Tests. commit `feat(chat): send new intake fields to profile endpoint`
- T5 — Frontend: ErrorBoundary + transición post-intake endurecida (S6).
  Tests. commit `fix(chat): error boundary and hardened post-intake transition`
- T6 — Verificación total: backend+frontend tests, typecheck, build.

## Log

- L1 — "peso kg / la parte que dice omnivoro este nombre normalmente no se
  conoce colocar algo mas normal de conocer / hay un error en algunos usuarios
  despues de llenar el formulario se queda la pantalla en blanco no pasa a la
  parte de escribir con el bot / en el formulario hay que ingresar alturas en
  mts / buscar una forma de preguntar si el usuario tiene algunas de estas
  tension tiroides colon diabetes hipoglisemia fatiga muscular / revisemos el
  formulario que tenemos y mirar de que forma podemos relacionar estas opciones
  y que quede fluido para llenar. no quitar lo que tenemos aunmentar y mejorar
  / alergia - cuando diga alergia debe escribir alergia a que"
- L2 — Decisiones: peso/altura opcionales; "Como de todo (carne, pescado,
  verduras)" con valor guardado "Omnívora"; "Problemas de colon"; bug
  reproducido "al terminar el cuestionario".
- L3 — Commits (rama feat/intake-health-data):
  7f409fd3 T1 backend fields · 6287aa94 T2 prompt · ca4ddd20 T3 intake UI ·
  154bd6ec T4 chat wire · d00f9f3f T5 error boundary. Verificación: backend
  291 tests + tsc OK; frontend 223 tests + tsc + build OK.
