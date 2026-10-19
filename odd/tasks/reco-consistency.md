# Feature: reco-consistency (catálogo único de recomendaciones + URL Amway)

Unificar las dos fuentes de recomendación del sitio (chat vs chequeo de 95
síntomas) en una sola: la tabla `products`. Completar los mapeos
nutriente→producto obvios que faltan y arreglar el link roto del botón
"Consultar precio". Rama: `fix/reco-consistency` (desde `main`).
Runner: `pnpm --dir backend test`, `pnpm --dir frontend test`,
`pnpm --dir frontend typecheck`, `pnpm --dir frontend build`.

## Specs

### S1 — El botón "Consultar precio" abre la ficha del producto en Amway

> "hay url que estan rotos"

El botón de cada producto en los resultados del chequeo
(`frontend/src/app/components/assessment/AssessmentResults.tsx:128`) apunta
hoy a `https://www.amway.es/search?q=<nombre del producto>`, una búsqueda que
devuelve una página sin resultados (verificado: `/search?q=110606` renderiza
solo el banner de cookies, mientras `/p/110606` devuelve la ficha con precio y
stock). Pasa a `https://www.amway.es/p/<reference>` (ficha directa del
producto, verificada para 100305, 100930, 121576 y 110606).

Comprobación: test que renderiza `AssessmentResults` con un producto y afirma
el `href` exacto `https://www.amway.es/p/<ref>`.

### S2 — El chequeo, el PDF y el email usan el mismo catálogo que el chat

> "presenta incosistencia en la recomendaciones"

Hay dos catálogos desincronizados. El chat inyecta la tabla `products` (16
productos, `backend/src/routes/assistant.ts:258`), mientras que el chequeo, el
PDF y el email usan un catálogo hardcodeado en
`backend/src/services/scoring.ts:167` (`PRODUCT_CATALOG`, 3 productos) con
nombre, categoría, dosis y beneficios distintos a los de la BD. Ejemplo real
de Eliana (19/10): el chat le dijo de Double X *"un comprimido de vitaminas,
uno de minerales y uno de fitonutrientes dos veces al día"* (6/día, de la BD) y
el PDF le dijo *"Tomar 2 tabletas amarillas, 1 tableta naranja y 1 tableta
verde dos veces al día con las comidas"* (8/día, del catálogo estático; la
ficha oficial de Amway declara 186 comprimidos = 31 días → 6/día, o sea la BD
es la correcta).

`getProductRecommendations` recibe el catálogo como parámetro y `PRODUCT_CATALOG`
se elimina. `assessmentService` lo lee de la tabla `products` (misma fuente que
`catalog.listAll()` del chat), `generateAssessmentPdf` deja de tener fallback
propietario y las rutas de PDF/email le pasan los productos calculados desde el
servicio. Los campos del wire (`reference, name, category, size, price,
benefits, dosage, addressesNutrients`) no cambian: solo cambia de dónde salen
los valores.

Comprobación: test de `POST /assessment/calculate` que puebla `products` con
una dosis única de prueba y afirma que la respuesta devuelve esa dosis (hoy
devolvería la del catálogo estático → RED), y test de `GET /assessment/:id`
que afirma el campo `productRecommendations` presente.

### S3 — Los urgentes sin producto lo dejan de estar

> "Unificar + completar obvios"
>
> "Fuente única de datos de producto (tabla products) Y agregar los mapeos
> directos que faltan: glucosamina→100108, proteína vegetal→110415,
> calcio/magnesio→110606 Cal Mag D Plus además de Double X. Cambia lo que ve
> la clienta (los urgentes dejan de quedar vacíos)."
>
> "  Glucosamina con Boswellia — Urgente → Nutrilite Glucosamina con Boswellia
>   Proteína 100% Vegetal — Urgente → Nutrilite Proteína Vegetal
>   Magnesio — En Falta → Cal Mag D Plus + Double X"

En `NUTRIENT_PRODUCT_MAP` (`backend/src/services/scoring.ts:140`) se agregan
exactamente estos mapeos, sin tocar los demás:

| nutriente | antes | después |
|---|---|---|
| `glucosamina_boswellia` | *(sin producto)* | `["100108"]` |
| `proteina_vegetal` | *(sin producto)* | `["110415"]` |
| `calcio` | `["121576"]` | `["121576", "110606"]` |
| `magnesio` | `["121576"]` | `["121576", "110606"]` |

El orden de las cards lo sigue fijando el sort existente (cobertura primero:
Double X cubre más nutrientes, así que encabeza; Cal Mag D Plus entra como
segunda opción).

Comprobación: tests de `getProductRecommendations` con catálogo de prueba que
afirman: glucosamina urgente → `100108` presente con ese nutriente en
`addressesNutrients`; proteína vegetal → `110415`; magnesio/calcio deficientes
→ ambos `121576` y `110606`; y que los nutrientes sin mapeo (coenzima Q10,
ajo, ginseng) siguen sin producto porque ese producto no existe en el catálogo.

### S4 — Nada más cambia (guard de regresión)

- El chat y su prompt no se tocan: sigue inyectando `catalog.listAll()` con el
  mismo wire.
- El helper del CRM admin `amwayProductUrl` (`frontend/src/app/admin/ProductRefs.tsx:11`)
  conserva `https://www.amway.es/Productos/c/100000?q=<ref>`: está verificado
  que devuelve resultados y tiene sus propios tests. No está roto, no se toca.
- `NUTRIENT_PRODUCT_MAP` fuera de las 4 filas de S3 queda idéntico.
- El contrato de `POST /assessment/calculate` y de `GET /assessment/:id` solo
  agrega `productRecommendations` a este último; ningún campo existente cambia
  de nombre ni de tipo.

Comprobación: suites backend y frontend completas en verde, `typecheck` y
`build` limpios.

## Tasks

| # | Task | S# | Ruta | Estado | Evidencia |
|---|------|----|------|--------|-----------|
| T1 | Frontend: `AssessmentResults` → `href="https://www.amway.es/p/<ref>"` + test RED | S1 | inline | done | RED: 2/2 en rojo (mostraba `/search?q=Nutrilite%E2%84%...`) → GREEN: `frontend/test/AssessmentResultsLink.test.tsx` 2/2. Commit `a2143072`. |
| T2 | Backend: `getProductRecommendations(results, catalog)` + eliminar `PRODUCT_CATALOG` + mapeos S3 + tests RED | S2, S3 | inline | done | RED: 6/8 en rojo (`[ '121576' ]` sin `110606`, glucosamina/proteína vacías) → GREEN: `test/product-recommendations.test.ts` 8/8. Commit `cc2bff49` (compartido con T3: firma + llamadores deben aterrizar juntos para que compile). |
| T3 | Backend: `assessmentService` lee `products`, `pdfService` sin fallback, rutas pasan productos + tests RED | S2 | inline | done | RED: 3/3 en rojo (GET /:id sin `productRecommendations`; calculate devolvía "Tomar 2 tabletas amarillas…") → GREEN: `test/assessment-product-catalog.test.ts` 3/3. Commit `cc2bff49`. |
| T4 | Cierre: suites backend+frontend, `typecheck`, `build` | S1-S4 | inline | done | Backend **267/267** + `tsc --noEmit` exit 0; frontend **212/212** + `typecheck` exit 0 + `build` ✓ (13.3s). |
| T5 | Verificador independiente (`gentle-ai-verify`, riesgo alto por contratos) | S1-S4 | subagente `gentle-ai-verify` | done | Task `mvfkl5gn-1-18zo`: **APPROVE**, S1-S4 PASS con evidencia file:line; re-corrí suites por su cuenta; mapa = exactamente las 4 filas de S3; `assistant.ts`/`prompt.ts`/`ProductRefs.tsx` intactos. |
| T6 | Revisión nativa (RDD on) | S1-S4 | inline `gentle_review` | done | Linaje `review-f7ed7c50fd7db7ac`, tier **medium**, lente `review-reliability`. 3 START con `consent-binding-expired` (sin mutación); el 4to resolvió. Forecast autorizado → **approved**. Acknowledge → autoridad **quemada**. |
| T7 | Advisory `R3-Wire-Extra-Fields`: no arrastrar `ingredients`/`disclaimer` al wire | — | inline | done | RED 1/9 (filtraba `ingredients`) → pick explícito de campos en `scoring.ts` → GREEN 9/9. Commit `3084dd88`. |
| T8 | Advisory `R3-EmptyReference-Link`: sin ancla con referencia vacía | — | inline | done | RED 1/3 (renderizaba `href="…/p/"`) → render condicional en `AssessmentResults.tsx` → GREEN 3/3. Commit `3084dd88`. |
| T9 | Advisory `R3-PdfRoute-Uncovered-Passthrough`: test de passthrough de la ruta PDF | — | inline | done | `assessment-pdf-passthrough.test.ts` (mock de `pdfService`): 2/2 VERDE sin fix — era cobertura faltante. Commit `3084dd88`. |
| T10 | Cierre: suites + checks + doc/espejo + assess del nuevo candidato + PR | S1-S4 | inline | done | Checks: frontend **213/213** (+1 = T8), frontend tsc 0, build ✓ 8.7s, backend tsc 0. Backend **269/270**: único fallo `reconsent.integration.test.ts` por timeout de 5s sobre una llamada REAL a Gemini (pasa 4/4 con `--testTimeout=30000`) — fragilidad pre-existente, sin relación con este cambio. Assess post-quema (`baseRef=d03c0b32`, committed-only): **risk medium, reviewDue=false (under_budget)** → sin revisión nativa requerida para este candidato; solo writerSelfVerification. PR = decisión del usuario. |

## Log

- L1 (petición original, verbatim): "quiero analizar el usuario Eliana Rincon
  Ossa con correo elinan19881988@gmail.com presenta incosistencia en la
  recomendaciones y hay url que estan rotos podemos revisar que esta pasando"
- L2 (2026-10-19, decisión de alcance): "proceder con los dos" → frente 1 URL
  rota + frente 2 catálogo unificado. En la pregunta de alcance del mapeo
  nutriente→producto eligió **"Unificar + completar obvios"** con el preview
  citado en S3.
- L3 (2026-10-19, diagnóstico previo): Eliana = `customers.id=8`
  (`elianan19881988@gmail.com`, el correo del pedido tenía un typo). El 19/10
  chat 14:27 recomendó `110606+121576`; chequeo 14:31 recomendó
  `121576+100930+100305`. PDF de su assessment: 13 nutrientes en falta/urgentes
  → solo 8 con "Tomar:"; glucosamina y proteína vegetal urgentes sin producto.
  `/search?q=` de amway.es sin resultados vs `/p/<ref>` con ficha completa.

- L4 (2026-10-19, cierre T1-T5): rama `fix/reco-consistency` con commits
  `a2143072` (S1), `cc2bff49` (S2+S3 — firma y llamadores aterrizan juntos
  para que el árbol compile) y `53a2816b` (doc). RED observado antes de cada
  implementación (S1: 2/2 en rojo; scoring: 6/8; API: 3/3) y GREEN final:
  backend **267/267** (25 archivos), frontend **212/212** (29 archivos),
  ambos `tsc --noEmit` exit 0 y `pnpm build` ✓ (13.3s). Verificador
  independiente `gentle-ai-verify` (task `mvfkl5gn-1-18zo`) → **APPROVE**,
  S1-S4 PASS con evidencia file:line, suites re-ejecutadas dos veces por él,
  diff del mapa confirmado como exactamente las 4 filas de S3 y
  `assistant.ts`/`prompt.ts`/`ProductRefs.tsx` intactos. Hallazgo residual del
  verificador: solo cosmético — el PDF ahora puede mostrar hasta 6 productos
  y categorías con el prefijo "Complementos alimenticios — ", sin verificación
  visual del layout.

  **Risk: item 3 (contratos que otros consumen)** — el contenido del PDF y de
  su adjunto por email, y los valores del wire de `/assessment/calculate`,
  pasan a salir de la tabla `products`; los nombres/tipos de campo no cambian.
  Es el fix pedido, cubierto por tests y por verificación independiente. Push /
  PR / deploy quedan como decisión del usuario.

**L5** (2026-10-19, revisión nativa aprobada): RDD on → `gentle_review`
sobre el rango `main...HEAD` (target `sha256:493f741a…`, 9 archivos / 752
líneas). Tres intentos de START con el consentimiento vencido
(`consent-binding-expired`, `lineage_created: false` — sin mutación); el
reintento autorizado por el usuario resolvió y creó el linaje
`review-f7ed7c50fd7db7ac` (tier **medium**, lente `review-reliability`,
presupuesto de corrección 200). Forecast de 1 corrida de modelo autorizado →
**state: approved** en el primer evento admitido. Acknowledge ejecutado con la
continuación exacta → **autoridad quemada** (`native-approved-acknowledgement-
completed`, `delivery: ordinary-repository-policy`). Hallazgos **advisory, no
bloqueantes** (ninguno abrió corrección):
- `R3-EmptyReference-Link` (SUGGESTION) `AssessmentResults.tsx:128` — link `/p/<ref>` con referencia vacía renderizaría `/p/`.
- `R3-PdfRoute-Uncovered-Passthrough` (SUGGESTION) `routes/assessment.ts:116` — el passthrough de `productRecommendations` a la ruta PDF no tiene test propio de la ruta.
- `R3-Wire-Extra-Fields` (WARNING) `scoring.ts:231` — el spread de la fila de `products` arrastra campos extra (p.ej. `disclaimer`, `ingredients`) al wire.
Son trabajo posterior aparte, nunca motivo de re-abrir este candidato.

**L6** (2026-10-19, advisories T7-T9 cerrados): el usuario pidió "dejamos todo
correctamente", así que se cerraron los 3 hallazgos advisory en el commit
`3084dd88`, cada uno con su RED previo:
- `R3-Wire-Extra-Fields` (WARNING): `getProductRecommendations` esparcía la
  fila de `products` y filtraba `ingredients`/`disclaimer` al wire; ahora arma
  el objeto con los campos declarados a mano.
- `R3-EmptyReference-Link`: con referencia vacía se renderizaba
  `href="…/p/"`; ahora el ancla no se emite y la card conserva sus datos.
- `R3-PdfRoute-Uncovered-Passthrough`: test nuevo que fija que la ruta PDF sí
  envía `productRecommendations` (verde sin fix: era cobertura faltante).
Checks de cierre: frontend **213/213** (+1 = T8), frontend tsc 0, build ✓ 8.7s,
backend tsc 0. **Backend 269/270** — el único fallo es
`reconsent.integration.test.ts` por timeout de 5s sobre una llamada REAL a
Gemini (la key viene de `.env` vía dotenv; la llamada tardó 7.6s; pasa 4/4 con
`--testTimeout=30000`). Fragilidad pre-existente del test, sin relación con
estos cambios: queda reportada, no arreglada (otro alcance).

**Risk: item 3 (contratos consumidos, parcialmente mitigado)** — al cerrar
`R3-Wire-Extra-Fields` el wire de `productRecommendations` deja de incluir
`ingredients`/`disclaimer`: ningún consumidor los usaba (el frontend no los
lee y el PDF solo consume los campos declarados), pero es un ajuste de
contrato observable y está cubierto por el test nuevo.

**L8** (2026-10-19, segunda revisión nativa sobre el candidato completo): el
recordatorio de RDD informó un candidato sin revisar (target
`sha256:6b0813fc…`, 10 archivos / 1011 líneas, ahora incluye el test de
passthrough). El usuario no lo había dejado sin revisar (pidió “dejamos todo
correctamente”), así que se corrió el ciclo: linaje `review-97bf63cc98390ec9`,
riesgo **medium**, lente `review-reliability`. El consentimiento lo resolvió
el host sin relay manual. La primera captura fue **rechazada en admisión**
(`submission-refused`: el payload del revisor no traía los arrays `findings` y
`evidence` explícitos; sin mutación, slot no consumido); con STATUS fresco se
reofreció el mismo slot y el reintento cerró en **approved**. Acknowledge →
autoridad **quemada**. **Sin hallazgos** que abrir. Feature completa y revisada
en su totalidad; el único paso restante es el PR, decisión del usuario.

**L7** (2026-10-19, cierre total): assess nativo del candidato post-quema
(`baseRef=d03c0b32`, committed-only, 6 archivos / 252 líneas) → **risk medium,
reviewDue=false (under_budget)**: el rango de advisories queda bajo el umbral
y no requiere una segunda revisión nativa; el plan exige solo
writerSelfVerification (las suites y typechecks de cierre). Feature cerrada;
falta únicamente el PR, que es decisión del usuario.

**L9** (2026-10-19, deuda de test cerrada): el usuario pidió arreglar el test
intermitente `reconsent.integration.test.ts` (causaba 269/270 por timeout de
5s sobre una llamada REAL a Gemini). Commit `866d1955`. Causa raíz:
`createAssistantRouter(db)` no tenía seam de inyección, así que `/assistant/ask`
construía el cliente Gemini real. Arreglo: mismo patrón que `createAdminRouter`
ya usaba — `createAssistantRouter` acepta `deps.geminiClient?` y `buildApp`
lo propaga (`BuildAppDeps`); el test inyecta un fake que captura el input y
responde fijo. Producción no pasa nada y sigue con el cliente real.
Verificado **SIN `GEMINI_API_KEY`**: 4/4 en 58ms (antes 7.6s), `tsc` exit 0,
suite backend completa **270/270**. Assess del nuevo candidato
(`baseRef=9b6e6b2d`, committed-only, 3 archivos / 49 líneas) → **risk medium,
reviewDue=false (under_budget)**: sin segunda revisión; self-verification ya
cubierta por la suite.

**L10** (2026-10-19, tercera revisión nativa, rango completo): el recordatorio
de RDD informó otro candidato sin revisar (target `sha256:d926f3a7…`, 13
archivos / 1087 líneas — ahora incluye `backend/src/index.ts`,
`backend/src/routes/assistant.ts` y `test/reconsent.integration.test.ts`, o
sea el fix de la deuda). El usuario no lo había dejado sin revisar, así que se
corrió el ciclo: linaje `review-982adb35c5c0ecd5`, riesgo **medium**, lente
`review-reliability`. El consentimiento lo resolvió el host. Forecast de 1
corrida autorizado → **approved** al primer evento admitido. Acknowledge →
autoridad **quemada** (`store_revision edc986b5…`). Hallazgos **advisory, no
bloqueantes** (ninguno abrió corrección, ninguno reabre este candidato):
- `R3-PDF-Layout-Overflow` (SUGGESTION) `scoring.ts:168` — el riesgo cosmético
  ya anotado en L4: más productos y categorías con prefijo largo en el PDF.
- `R3-Reference-Trim-Defensive` (SUGGESTION) `AssessmentResults.tsx:130` —
  el guard del href ya hace `.trim()`; el revisor sugiere defensa adicional.
Son trabajo posterior aparte. Feature completa: **3 revisiones nativas
aprobadas y quemadas** (reco-consistency + advisories + rango completo).

**L11** (2026-10-19, advisories de la revisión #3 cerrados): siguiendo la
instrucción "continuar", se cerraron los 2 advisories de L10.
- `R3-Reference-Trim-Defensive` (SUGGESTION, `AssessmentResults.tsx`): el guard
  de referencia vacía ya hacía `.trim()` pero el href usaba la referencia
  CRUDA — `" 110606 "` pasaba el check y producía `…/p/%20110606%20`. Ahora un
  único valor `reference` (trimmed) alimenta guard y href. RED→GREEN: test que
  afirma `…/p/110606` con `" 110606 "` (RED recibía `%20110606%20`) → GREEN 4/4.
  Commit `b2ebb763`.
- `R3-PDF-Layout-Overflow` (SUGGESTION, `scoring.ts:168`): cerrado por
  **VERIFICACIÓN sin fix**. El riesgo era la tarjeta de "Detalle de Productos"
  con altura fija 85pt y textos de largo variable. Se generó un PDF con **6
  productos y textos largos** (peor caso razonable: Double X con benefits de 2
  líneas + dosis de 2 líneas, categorías con el prefijo "Complementos
  alimenticios — "), se renderizó a PNG con `pdftoppm` y se leyó la imagen: las
  6 tarjetas contienen todo el texto sin solapamiento ni desborde. Riesgo
  teórico, no materializado con datos reales.
Checks de cierre: frontend **214/214** (+1 = test de trim), backend **270/270**,
frontend `tsc` 0, `build` ✓ 10.4s.

**L12** (2026-10-19, cuarta revisión nativa): el recordatorio de RDD informó
otro candidato sin revisar (target `sha256:e6ab7ba7…`, 13 archivos / 1145
líneas — el rango completo tras T14-T15). El usuario no lo había dejado sin
revisar, así que se corrió el ciclo: linaje `review-aa7910133107f98b`, riesgo
**medium**, lente `review-reliability`. Consentimiento resuelto por el host.
Forecast de 1 corrida autorizado → **approved** al primer evento admitido.
Acknowledge → autoridad **quemada** (`consumed_revision cd79264f…`). Hallazgos
**advisory, no bloqueantes** (ninguno abrió corrección, ninguno reabre este
candidato):
- `R3-Catalog-PerCall-Read` (SUGGESTION) `assessmentService.ts:132` —
  `loadCatalog()` lee la tabla `products` entera en cada llamada (calculate /
  getById). El revisor sugiere eficiencia; comportamiento correcto hoy.
- `R3-Key-Uses-Raw-Reference` (SUGGESTION) `AssessmentResults.tsx:99` — el
  `key` del `<Card>` usa `product.reference` crudo mientras el href usa el
  trimmed. Un duplicado con espacios distintos generaría dos keys distintas;
  cosmético, sin efecto visible con datos reales.
Son trabajo posterior aparte. **4 revisiones nativas aprobadas y quemadas**
en total sobre esta feature.

**L13** (2026-10-20, advisories de la revisión #4 cerrados): el usuario
respondió "1. si / 2. si" — cerrar los 2 advisories y abrir el PR.
- `R3-Key-Uses-Raw-Reference` (SUGGESTION, `AssessmentResults.tsx:99`): cerrado
  con **fix** — el `key` del `<Card>` pasó de `product.reference` (crudo) a
  `reference` (trimmed), el mismo valor que alimenta al guard y al href.
  Nota de proceso: un `key` de React **no es observable en el DOM**, así que
  no hay RED honesto posible (antes y después renderizan idéntico). En vez de
  inventar un test que no distingue el cambio, se cerró con verificación
  estructural: `grep` confirma `key={reference}` en la línea 99, `tsc` exit 0
  y suite frontend completa **214/214**.
- `R3-Catalog-PerCall-Read` (SUGGESTION, `assessmentService.ts:132`): cerrado
  como **reasoned-won't-fix**, SIN código. Al verificar el hallazgo: ningún
  camino de request llama a `loadCatalog()` más de una vez — `calculate()` lo
  llama una vez y `getById()` lo llama una vez, y son **endpoints distintos**
  (no hay request que ejecute ambos). Memoizar entre requests agregaría un
  estado cacheado que puede servir un producto VIEJO tras una edición en el
  CRM (rompería la garantía de frescura de S2) a cambio de evitar **un**
  `SELECT` de 16 filas por request. El costo de la optimización supera su
  beneficio; se deja el read directo y el advisory queda cerrado con esta
  rationale documentada (mismo criterio que R3-PDF-Layout-Overflow en L11).

**L14** (2026-10-20, quinta revisión nativa + PR abierto): el recordatorio de
RDD informó otro candidato sin revisar (target `sha256:46664554…`, 13 archivos
/ 1187 líneas — el mismo rango, con el doc actualizado). El usuario no lo había
dejado sin revisar, así que se corrió el ciclo: linaje
`review-5dfffd5cb7b31018`, riesgo **medium**, lente `review-reliability`.
Consentimiento resuelto por el host. Forecast de 1 corrida autorizado →
**approved** al primer evento admitido. Acknowledge → autoridad **quemada**
(`consumed_revision 0236fa17…`). Hallazgos **advisory, no bloqueantes**
(ninguno abrió corrección, ninguno reabre este candidato):
- `R3-CatalogDuplicateRefLastWins` (SUGGESTION) `scoring.ts:223` — un `Map`
  indexado por referencia: si la tabla tuviera dos filas con la misma
  referencia (imposible hoy: `reference` es PRIMARY KEY), la última ganaría.
- `R3-PdfRuntimeUnguarded` (SUGGESTION) `pdfService.ts:130` — el builder
  asume `productRecommendations` definido; el tipo lo exige en compile y las
  rutas siempre lo pasan (test de passthrough).
- `R3-ReadTimeCatalogDrift` (SUGGESTION) `assessmentService.ts:281-285` —
  `getById` recalcula al leer, así que un PDF re-generado tras editar el
  catálogo reflejaría el dato nuevo. Ese es el COMPORTAMIENTO DESEADO de S2
  (misma frescura que el chat), no un defecto.
Son trabajo posterior aparte. **5 revisiones nativas aprobadas y quemadas**
en total sobre esta feature.

**L15** (2026-10-20, entrega): el usuario respondió "1. si / 2. si" — cerrar
los advisories de la revisión #4 y abrir el PR. Se cerraron (L13) y se abrió
el PR respetando la convención issue-first del repo: se creó el issue **#55**
SIN `status:approved` (la aprobación es señal del humano, no se infiere), el
usuario autorizó con `approve_and_open`, se aplicó el label, se hizo push de
la rama y se abrió el PR **#56** con label `type:chore` (único `type:*`
existente) y cuerpo armado a mano (no hay `PULL_REQUEST_TEMPLATE.md`). CI
verde: Backend (test+typecheck) pass 22s, Frontend (test+typecheck+build)
pass 58s, GitGuardian pass, Vercel pass (Canceled by Ignored Build Step,
esperado). Estado: PR OPEN y MERGEABLE; el merge queda como decisión del
usuario.

**L16** (2026-10-20, advisories de la revisión #5 cerrados): el usuario pidió
"seguir tu recomendacion", así que los 3 advisories de L14 se cierran como
**reasoned-won't-fix**, SIN código:
- `R3-CatalogDuplicateRefLastWins` (`scoring.ts:223`): el `Map` indexado por
  referencia solo vería un duplicado si la tabla tuviera dos filas con la misma
  `reference`, y esa columna es **PRIMARY KEY** — el duplicado es imposible por
  diseño. Agregar dedup sería código muerto sobre una garantía que ya da la BD.
- `R3-PdfRuntimeUnguarded` (`pdfService.ts:130`): el campo es **requerido en el
  tipo** (`PdfOptions.productRecommendations`), así que un call site sin él no
  compila; las dos rutas lo pasan y eso está fijado por
  `assessment-pdf-passthrough.test.ts`. Un guard en runtime duplicaría una
  garantía que ya dan el tipo y el test.
- `R3-ReadTimeCatalogDrift` (`assessmentService.ts:281-285`): recalcular al
  leer es **el comportamiento deseado de S2** — el PDF re-generado debe ver el
  mismo catálogo fresco que el chat. "Arreglarlo" persistiendo los productos al
  guardar recrearía exactamente el bug de deriva que esta feature eliminó.
Total: **10 advisories en 5 revisiones, todos cerrados** — 7 con fix o
verificación, 3 con rationale. El PR #56 queda con 17 commits y CI verde.
