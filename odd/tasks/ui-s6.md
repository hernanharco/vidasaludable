# UI S6 — pool priorizado de ui-optimization (search, truncado, motion, headings, toasts, quick wins)

Continuación de `ui-optimization.md` S6 (pool diferido, "disponibles a pedido").
Alcance elegido por el usuario: **priorizado por impacto** — los ítems de mayor
valor/esfuerzo sin tocar nada que requiera cambio de API. Web pública + admin;
ningún endpoint cambia; ninguna pantalla se pierde.

## Specs

**S1 — request + selección (verbatim)**
> en este proyecto que teniamos pendiente

> vale procedamos cont odo

con alcance elegido en el formulario:
> "Priorizado por impacto (recomendado)" — "Elijo los de mayor valor/relación-esfuerzo
> (search, toasts, reduced-motion, truncado, headings) y dejo los que requieren
> cambio de API (paginación server-side) para después. 1-2 PRs encadenados."

**S2 — fuera de alcance (diferidos, documentados en ui-optimization.md S6)**
- Paginación/búsqueda **server-side** (requiere cambio de API).
- Contrastes emerald (requiere decisión de diseño).
- Copy voseo/tú (requiere auditoría + decisiones de copy del usuario).
- Booking fake (`components/Booking.tsx:15-22` simula el envío con `setTimeout`;
  reemplazarlo por un envío real es decisión de producto, no UI).
- `confirm()` → `alert-dialog`: **ya cerrado** por PR #45 (grep `window.confirm`/`alert(`
  en `frontend/src` = 0) — queda fuera por resuelto, no por diferido.
- `ui/card.tsx:33` `CardTitle` default `h4`: no se toca (afecta a todos los cards).

**S3 — Search client-side en tablas admin (T1)**
Evidencia: `admin/DataTable.tsx:39-66` no expone ninguna prop de search/filter;
pipeline `sortedRows` (:179) → `paginateRows` (:185); 13 tablas/8 páginas con
`rows=` (CustomersPage:111, ConversationsPage:92, PurchasesPage:153,
CatalogPage:259, GuidancePage:321, ReferrersPage:363+374, VideosPage:482+684,
AssessmentAdminPage:595/676/751/772); grep `search|filter|toLowerCase` en
`admin/` no arroja ningún input ni estado de búsqueda.
Required:
- (a) helper **puro exportado** `filterRows(rows, query, getText)` (o equivalente):
  trim, case-insensitive, sin acentos (normalización `NFD`+`diacríticos`), query
  vacía → las mismas filas, stable (preserva orden). RED→GREEN con tests de
  lógica pura: vacío, mayúsculas, acentos, sin match, orden.
- (b) `DataTable`: props opcionales `searchable?: boolean` + `searchText: (row) =>
  string`; input `type="search"` con label/`aria-label` visible, acotado a la
  tabla; filtra **antes** de paginar y resetea/clampa la página al cambiar la
  query; empty state distinto cuando hay query activa ("Sin resultados…", con la
  query); sin props → comportamiento byte-idéntico al actual.
- (c) habilitado en estas 9 tablas: Customers, Conversations, Purchases, Catalog,
  Guidance, Videos (tabla de videos), Videos (segmentos), AssessmentAdmin
  (symptoms) y (nutrients), Referrers (tabla principal). **Decisiones**: NO en
  AssessmentAdmin mappings/results (datos numéricos/ids) ni en el anidado
  `r.customers` de Referrers (listas cortas) — documentado aquí como corte.

**S4 — Truncado de campos largos (T1)**
Evidencia: única celda con clamp `GuidancePage.tsx:160-161` (`line-clamp-3`);
texto largo sin acotar: `CustomersPage.tsx:41`, `CatalogPage.tsx:84`,
`AssessmentAdminPage.tsx:288,321`, `ReferrersPage.tsx:121`, `VideosPage.tsx:317`
(+ `:288-296` license con `max-w-xs` pero nota sin clamp).
Required:
- (a) flag opcional `truncate?: boolean` en `DataTableColumn<T>`: la celda envuelve
  el output de `render` en un `block max-w-[28ch] truncate` (con `title` cuando el
  render devuelve string plano, para conservar el texto completo al hover).
- (b) aplicado a las columnas listadas en la evidencia (nombre/título) y la nota
  de licencia de Videos (`line-clamp-2`); Guidance conserva su `line-clamp-3`.
- (c) verificación estructural (clases presentes + suite); sin cambio de layout
  fuera de esas columnas.

**S5 — Reduced motion global (T2)**
Evidencia: 0 matches de `prefers-reduced-motion` en `frontend/src`; `styles/`
solo importa `tw-animate-css` (`styles/tailwind.css:4`); motion por todas partes:
`animate-pulse` (`ui/skeleton.tsx:7`), `animate-spin`
(`AssessmentWidget.tsx:245,270,353`, `AccessCodeGate.tsx:132`), framer
(`Hero.tsx:19-26,83-128`, `Booking.tsx:35-39,77-79`, `About.tsx:53-119`,
`Services.tsx:47-49`, `Navbar.tsx:26-27,76`), `animate-in/out` de Radix
(`ui/dialog.tsx:41,60`, `alert-dialog.tsx:39,57`, `sheet.tsx:39,61`, `popover.tsx:33`,
`tooltip.tsx:49`, `accordion.tsx:58`, `input-otp.tsx:62`).
Required:
- (a) regla global `@media (prefers-reduced-motion: reduce)` en el CSS principal
  (`styles/index.css`): animaciones/transiciones a prácticamente 0,
  `scroll-behavior: auto` — sin `!important` innecesario donde la cascada baste,
  con `!important` donde Tailwind lo exija.
- (b) framer: `<MotionConfig reducedMotion="user">` envolviendo la app (`App.tsx`)
  para que las variantes framer respeten el setting del sistema.
- (c) verificación: grep de la regla + suite + tsc + build (cambios de CSS no
  tienen aserción jsdom natural; la política S9 aplica).

**S6 — Jerarquía de headings (T3)**
Evidencia (sin saltos de nivel, un h1 por pantalla):
- `admin/AssessmentAdminPage.tsx:510` h1 → h3 (:549, :613, :694), salta h2.
- `admin/CustomerDetailPage.tsx:39` h3 antes del h1 (:201/:219 son ramas
  exclusivas; h1 :219 + h2 :243+ OK).
- `admin/PurchasesPage.tsx:54` h2 (rama "acceso restringido") antes del h1 :89.
- `admin/AdminLayout.tsx:286,294` h2 sin h1 en ramas de error; `ErrorBanner.tsx:64` h2.
- `components/Hero.tsx:33` h1 → h3 (:100,:118,:136), sin h2.
- `components/About.tsx:98` h2 → h4 (:126), salta h3.
- `components/Booking.tsx:45` h2 → h4 (:59,:68) → h3 (:88,:101), h4 antes que h3.
- `components/Footer.tsx:30,41` solo h4.
- h4-sin-encima: `AccessCodeGate.tsx:71`, `RegistrationGate.tsx:57`,
  `chat/ChatIntake.tsx:189`, `chat/ChatHeader.tsx:16`,
  `assessment/AssessmentResults.tsx:55,89,145`, `AssessmentWelcome.tsx:26` (h3 solo).
Required:
- (a) cada pantalla/screenlet arranca en el nivel correcto (h1 de la página,
  h2 de sección, h3 de sub-sección) **sin saltar niveles**; los cambios son de
  tag, conservando exactamente las mismas clases → cero cambio visual
  (Tailwind preflight resetea la tipografía por nivel).
- (b) ramas de error/restricted también respetan la jerarquía de su pantalla.
- (c) verificación estructural (grep de niveles por archivo) + suite + tsc + build.

**S7 — Toasts de feedback en admin (T2)**
Evidencia: `sonner@2.0.3` instalado (`frontend/package.json:67`) y
`components/ui/sonner.tsx` existe, pero grep `Toaster|toast(` solo matchea ese
archivo (nunca montado, cero llamadas); los deletes con `ConfirmActionDialog`
(10 sitios/8 páginas) terminan sin feedback audible visible más allá del estado.
Required:
- (a) `<Toaster />` (el wrapper propio de `ui/sonner.tsx`) montado en `App.tsx`.
- (b) `toast.success(...)` al confirmar cada delete migrado a `ConfirmActionDialog`
  (Customers, Conversations, Referrers, Guidance, Catalog, Videos ×2,
  AssessmentAdmin ×3): mensaje corto y específico de la entidad. Solo deletes —
  guardar/crear queda fuera para no inflar el alcance.
- (c) tests: 1 test de que `App` monta el Toaster + 1 test de que confirmar un
  delete dispara `toast.success` (mock de sonner). RED primero.

**S8 — Quick wins (T4)**
Evidencia:
- (a) `href="#"` ×5 en `components/Footer.tsx:19,22,32,62,63`; `Hero.tsx:7` con
  `id="#"`.
- (b) `parseRefs` definido 3 veces: `GuidancePage.tsx:15`, `RecommendationsPage.tsx:6`,
  `CustomerDetailPage.tsx:20` (usos :167,:169 / :75 / :319).
- (c) `chatError` muerto: `ChatSession.tsx:149` state, solo `setChatError(null)`
  (:448,:507,:541), prop requerida en `ChatMessages.tsx:26`, rama render :226-229
  nunca tomada; 5 tests la pasan (`AssessmentCard.test.tsx:42`,
  `AccessibilityChat.test.tsx:22`, `VideoCards.test.tsx:48`,
  `ProductCards.test.tsx:91,184`).
Required:
- (a) "Inicio" (Footer) y cualquier ancla interna → `#inicio` con `id="inicio"`
  en el Hero (reemplaza `id="#"`); legales y redes **sin destino real** dejan de
  ser `<a>`: pasan a `<span>` no interactivo (afuera el affordance falso, sin
  inventar URLs) — decision documentada.
- (b) helper compartido `frontend/src/app/lib/parseRefs.ts` (mismo comportamiento
  que los 3 copies); las 3 páginas lo importan; test RED→GREEN del helper
  (JSON válido, string no-array, string malformado, null/undefined).
- (c) `chatError` eliminado del state, la prop y la rama de render (verificando
  antes que no haya otro sender de errores de chat vivo que dependa de ella) y los
  5 tests actualizados; si el writer encuentra dependencia viva → parar y reportar,
  no wirear errores nuevos.

**S9 — Política de verificación**
Igual que `ui-optimization.md` S7: RED→GREEN para lógica pura y aserciones ARIA
jerárquicas testeables (S3a, S7c, S8b); verificación estructural proporcional para
clases/tags (S4, S5, S6); al cierre de cada tarea: suite completa frontend,
`tsc --noEmit`, `vite build`. Los writers no commitean; el parent cierra cada
tarea con su work-unit commit. `.gitignore` con `.codegraph/` (ya escrito) entra
en el primer commit de este feature.

## Chain

| PR | Tareas | Contenido |
|----|--------|-----------|
| A | T1 (S3+S4) | DataTable: search + truncado |
| B (stacked sobre A) | T2 (S5+S7) + T3 (S6) + T4 (S8) | reduced-motion, toasts, headings, quick wins |

## Tasks

| ID | Spec | Route | Commit |
|----|------|-------|--------|
| T1 | S3+S4 | writer (DataTable + 9 tablas) | — |
| T2 | S5+S7 | writer (CSS/MotionConfig/App + deletes) | — |
| T3 | S6 | writer/parent (headings, ~14 archivos) | — |
| T4 | S8 | writer/parent (Footer/Hero, lib/parseRefs, chatError) | — |
| T5 | S1-S9 | verificación final + cierre | — |

T2/T3/T4 comparten archivos con T1 en admin → secuenciales (PR B sobre PR A),
nunca writers paralelos.

## Log

**L1** (user request, verbatim)
> en este proyecto que teniamos pendiente

> vale procedamos cont odo

**L2** Formulario de alcance (respuesta del usuario, verbatim):
> "Priorizado por impacto (recomendado)" — "Elijo los de mayor valor/relación-esfuerzo
> (search, toasts, reduced-motion, truncado, headings) y dejo los que requieren
> cambio de API (paginación server-side) para después. 1-2 PRs encadenados."

**L3** Exploración `gentle-ai-explore` (read-only, evidencia path:line por ítem):
confirmó que no existe search en admin, que el truncado solo vive en
`GuidancePage:160`, que no hay ninguna regla `prefers-reduced-motion`, que
`sonner` está instalado pero sin montar, el mapa completo de headings y los tres
quick wins. El grep de `alert(`/`window.confirm` = 0 → el ítem "confirm→alert-dialog"
del pool ya está cerrado por PR #45.

**L4** Chain A — T1 (S3+S4) implementado por writer con Allowed edit surfaces;
RED→GREEN (17 tests nuevos), verificación parent 201/201 + tsc + build; review
nativo `review-ae954835d5fce811` (medium, 4 lentes) **APPROVED**, receipt
quemado, 5 advisory (2 WARNING sobre `searchable` sin `searchText` → corregido
en T4). Commit `49b3816b` (+ docs `17b67633` con `.gitignore` de `.codegraph/`);
PR **#51** squash-mergeado a `main` como `83216957` con CI + Deploy verdes.
Issue #50 abierto a propósito hasta chain B.

**L5** Chain B — T2 (`1b585958`): S5 (regla global + `MotionConfig`) y S7
(`<Toaster/>` + 10 `toast.success`), suite 204/204; el mock de `motion/react` en
`ChatLauncher.test.tsx` necesitó `MotionConfig` stub + `matchMedia` (jsdom sin
`matchMedia`, sonner lo llama sin guardar) — decisión del parent, opción 1 del
writer. T3+T4 (`dd9273af`): headings tag-only (~16 archivos) + quick wins +
fix del advisory (`DataTable` input gated en `searchable && searchText`), suite
**210/210** (28 files) + tsc + build. Review `review-90572f3f82431916` (medium,
4 lentes) **APPROVED**, receipt quemado, 4 advisory informativos (el grupo de
lecturas falló 2× por transporte en `readability` y cerró al 3er intento, slot a
slot). Rebase limpio sobre `83216957` → commits `e53a70e4` + `d5c41226`;
post-rebase 210/210 + tsc + build verdes.

**L6** Desviaciones registradas (todas deliberadas, ninguna rompe S9):
1. `ErrorBanner` ganó `headingLevel?: 1 | 2` (default 2 = comportamiento previo
   byte-idéntico): un tag fijo no puede servir a las ramas exclusivas (h1) y a
   las embedidas sin romper "un h1 por pantalla".
2. `RegistrationGate` vive en `components/chat/RegistrationGate.tsx` (el spec
   listaba un path `components/` viejo; es el único del repo).
3. **Pendiente conocido**: `ErrorBanner` embedido en 4 páginas fuera de las
   superficies de esta tarea (`CustomersPage`, `ConversationsPage`,
   `CatalogPage`, `Dashboard`) puede renderizar h2 sobre el h1 de la página en
   estados de error — no estaba en los flags de S6.
4. El target `c6ae20f9…` (diff commiteado T1+T2) no pudo iniciar review (2×
   `empty_candidate_base_ref_required`, sin linaje creado); T1 y T3+T4 tienen
   receipt APPROVED propio y T2 queda como candidato para un retry o verifier
   independiente al cierre.
5. Smoke end-to-end pendiente por DNS: `vidasaludable.rincon.es` no resuelve
   desde la máquina del agente (000); el pipeline CI+Deploy es la señal viva.
