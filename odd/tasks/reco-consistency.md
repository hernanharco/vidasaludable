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
| T4 | Cierre: suites backend+frontend, `typecheck`, `build` | S1-S4 | inline | pending | |
| T5 | Verificador independiente (`gentle-ai-verify`, riesgo alto por contratos) | S1-S4 | subagente `gentle-ai-verify` | pending | |

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
