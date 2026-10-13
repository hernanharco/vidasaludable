# UI optimization —4 paquetes (a11y, estados admin, performance, DataTable)

Cuatro unidades autorizadas por el usuario a partir de dos auditorías read-only
(explore, con evidencia path:line). Web pública y admin; ninguna pantalla se
pierde, ningún endpoint cambia.

## Specs

**S1 — request + selección (verbatim)**
> para poder tener un proyecto optimo en la UI que se podria mejorar?

Selección en formulario (las cuatro opciones):
> "Base admin sólida (Recommended)" — ErrorBanner con retry + mensaje honesto,
> drawer con Escape/focus, sort accesible — cierra los P1 que dejan páginas muertas
> "A11y web + chat" — Assessment como ui/dialog, chat con aria-live y labels — cierra los 3 P1 de accesibilidad
> "Performance bundle" — React.lazy por ruta, fuentes con preconnect, srcset en About, defer del fetch pre-gate
> "DataTable compartida" — un DataTable con columnas, sort y paginación que reemplaza las 10 copias — el más grande, abre el camino a búsqueda/paginación

**S2 — Performance bundle (T1)**
Evidencia: sin code-splitting, `App.tsx:46-64` importa estáticamente todas las
páginas de admin; `PurchasesChart.tsx:9` y `TrendCharts.tsx:9` importan recharts
→ el visitante del landing descarga el admin completo. Fuentes por `@import`
(`styles/fonts.css:1` ← `styles/index.css:1`), sin `preconnect`
(`index.html`). `About.tsx:44,56`: Unsplash fijo `w=1080`, sin `srcset` ni
`width/height`. `ChatSession.tsx:150-208`: fetchea catálogos de videos+productos
al boot, antes del gate de acceso.
Required:
- (a) rutas de admin con `React.lazy`/`Suspense` en `App.tsx` (fallback aceptable:
  el `<p>Cargando…</p>` existente); el chunk de recharts deja de viajar al landing
  (verificable en el output de `vite build`).
- (b) `preconnect` a `fonts.googleapis.com` y `fonts.gstatic.com` en `index.html`;
  la cadena de `@import` de fuentes resuelta en el CSS principal (un solo request
  de CSS, sin import anidado).
- (c) `About.tsx`: `srcset`/`sizes` con variantes Unsplash (`w=`) + `width`/`height`
  explícitos en ambos `<img>`; el layout no cambia.
- (d) el fetch de catálogos se difiere hasta `phase === "chat"` (o posterior al
  gate): una visita que no entra al chat no hace esas dos llamadas. Los tests
  existentes que asumen el boot viejo se actualizan al nuevo comportamiento.

**S3 — A11y web + chat (T2)**
Evidencia:
- `AssessmentWidget.tsx:170-186`: modal a mano, sin `role="dialog"`,
  `aria-modal`, focus trap, Escape, ni focus restore. `ui/dialog.tsx` (Radix)
  existe sin usar. `:190-194` close `p-1` ≈28px. `:293-299` email sin label.
- `ChatInput.tsx:15-21`: input solo con placeholder; `:24-35` submit icon-only
  sin `aria-label`.
- `ChatMessages.tsx:169-195`: lista sin `role="log"`/`aria-live="polite"`;
  `:196-199` typing indicator sin `role="status"`.
Required:
- (a) Assessment renderizado como diálogo accesible vía `ui/dialog.tsx` (o con
  `role="dialog"`, `aria-modal`, focus trap, Escape y restore equivalentes si el
  primitive no encaja): comportamiento visible idéntico.
- (b) input del chat con nombre accesible (`aria-label`), submit con
  `aria-label`, lista de mensajes anuncia respuestas nuevas (`aria-live`
  polite o `role="log"`), "Escribiendo..." con `role="status"`.
- (c) cada atributo verificado por test RTL (`getByRole`/accessible name),
  RED primero.

**S4 — DataTable compartida (T3)**
Evidencia: 3 dialectos de tabla en 10 páginas — A (`CustomersPage.tsx:35-41`,
`ConversationsPage.tsx:38-44`, `PurchasesPage.tsx:103-109`,
`CatalogPage.tsx:198-204`, `GuidancePage.tsx:205-211`, `VideosPage.tsx:415-421`
y `:505-511`), B (`ReferrersPage.tsx:189-197`, `AssessmentAdminPage.tsx:431-437`),
C (`RecommendationsPage.tsx:47-66`, card list). `useTableSort`+`SortableTh`
(`AssessmentAdminPage.tsx:28-73`) son locales y mouse-only (sin `aria-sort`
ni teclado). `ui/table.tsx` existe sin usar. Sin paginación en ninguna lista;
las APIs no aceptan limit/offset (fuera de alcance: ver S6). Sin empty state en
Customers/Conversations/Purchases.
Required:
- (a) componente `DataTable` en `frontend/src/app/admin/` (o `ui/`): defs de
  columnas, sort accesible (`aria-sort`, headers como botón, Enter/Espacio),
  paginación client-side (page size razonable p. ej. 20, controles con
  `ui/pagination` o equivalente accesible), empty state con mensaje, wrapper
  scroll horizontal con `min-w-[640px]` (no perder ninguna columna).
- (b) las 10 páginas migradas; las columnas y acciones existentes se conservan
  una a una; sort heredado de AssessmentAdminPage disponible en cualquier
  columna que la página lo declare.
- (c) el sort/paginación se implementa como lógica pura exportada y testeada
  (RED→GREEN): orden numérico vs string, stable sort, páginas al borde.

**S5 — Base admin sólida (T4, sobre las páginas ya migradas por T3)**
Evidencia: error a página completa rotulado "Acceso restringido" para cualquier
fallo en 7 páginas (`CustomersPage.tsx:22-27`, `ConversationsPage.tsx:26-31`,
`RecommendationsPage.tsx:22-27`, `ConversationDetailPage.tsx:21-27`,
`Dashboard.tsx:166-174`, `CatalogPage.tsx:71-78`, `GuidancePage.tsx:146-152`),
sin retry en 4 de ellas. `alert()` en borrados (`CustomersPage.tsx:72-81`,
`ConversationsPage.tsx:70-81`). Drawer sin Escape/focus trap/scroll lock
(`AdminLayout.tsx:122-145`), collapse toggle sin `aria-expanded` (`:166-176`).
Required:
- (a) componente `ErrorBanner(message, onRetry?)` con `role="alert"`: mensaje
  honesto (distingue fallo de red/servidor de "acceso restringido" real — 401/403
  sí rotula autorización), retry donde hay `onRetry`; reemplaza los banners en
  las 7 páginas; `alert()`/`confirm()` de borrados reemplazados por el banner
  inline con rollback o recarga consistente (nunca fila optimista sin
  recuperación).
- (b) drawer del admin: Escape cierra, focus trap mientras está abierto,
  restauración del foco al botón que lo abrió, scroll lock del body,
  `aria-expanded`/`aria-controls` en el toggle. Comportamiento desktop intacto.
- (c) tests: ErrorBanner (render, retry invocado, 401 vs 500 rotulan distinto) y
  drawer (Escape dispara cierre, trap) — RED primero.

**S6 — Fuera de alcance (diferido, no trackeado)**
Paginación/búsqueda server-side (requiere cambio de API), search/filter por
tabla, reduced-motion global, jerarquía de headings, contrastes emerald,
`chatError` dead code, Booking fake, copy voseo/tú, anchors `href="#"`,
truncado de campos largos, toasts (`ui/sonner`), `confirm()` → `alert-dialog`
en el resto, `parseRefs` duplicado. Disponibles a pedido.

**S7 — Política de verificación**
Test-first donde hay lógica o atributos ARIA asertables en jsdom (S3, S4c, S5c,
S2d); verificación estructural proporcional para clases/attrs puros (S2a build
output, S2b/c greps). Al cierre de cada tarea: suite completa frontend, `tsc
--noEmit`, `vite build`. Los writers no commitean; el parent cierra cada tarea
con su work-unit commit.

## Tasks

| ID | Spec | Route | Commit |
|----|------|-------|--------|
| T1 | S2 | writer W1 (superficie web perf) | `52bfc01a` |
| T2 | S3 | writer W2 (superficie web a11y) | `adcda32b` |
| T3 | S4 | writer/parent (superficie admin tablas) | `4a4748f4` |
| T4 | S5 | parent sobre páginas migradas | `a3a1dcde` |
| T5 | S1-S7 | verificación final + cierre | — |

T1 y T2 corren en paralelo (superficies disjoint). T3 y T4 son secuenciales
(ambos tocan las páginas de admin; T4 se aplica sobre el resultado de T3).

## Log

**L1** (user request, verbatim)
> para poder tener un proyecto optimo en la UI que se podria mejorar?

**L2** Dos auditorías read-only (`gentle-ai-explore`, superficies disjointas)
con evidencia path:line: web pública (a11y, performance, estados, consistencia)
y admin (a11y, estados, data-dense, consistencia). Ambas confirmaron que los
P1/P2 de mobile-ui ya cerrados no reaparecen.

**L3** Selección del usuario: las CUATRO opciones del formulario
("Base admin sólida", "A11y web + chat", "Performance bundle", "DataTable
compartida").

**L4** Plan: T1∥T2 en paralelo (web, disjoint), T3 (DataTable + migración de
10 páginas, el bloque más grande), T4 sobre páginas migradas, T5 cierre.
Orden T3→T4 porque ErrorBanner se inserta en la estructura que deja DataTable.

**L5** T1 (writer W1) GREEN en S2a-d: recharts (408 kB) fuera del chunk de
entrada (evidencia en el output de `vite build`); 48 `@font-face` inlineados,
sin `@import` remoto; srcset/sizes + width/height en las dos fotos de About;
defer del fetch de catálogos con test RED→GREEN (`PerfCatalogDefer`).
Seguimiento inline: comentarios stale de `types.ts` actualizados. Commit
`52bfc01a`.

**L6** T2 (writer W2) GREEN en S3a-c: Assessment vía Radix `ui/dialog`
(role=dialog, aria-modal, trap, Escape, restore; adaptaciones Radix v1.1.6
documentadas en el handoff), ChatInput/ChatMessages con nombres accesibles,
`role="log"`/`role="status"`. RED 9→GREEN 9. Seguimiento inline: aria-label del
botón de enviar email en resultados. Commit `adcda32b`.

**L7** T3 (writer) GREEN en S4a-c: `DataTable.tsx` con sort accesible
(aria-sort + botón nativo), paginación client-side (size 20), empty state,
min-w-[640px]; 9 tablas migradas en 8 páginas, columnas/acciones/filtros
preservados; `useTableSort`/`SortableTh` locales reemplazados; Referrers
cards móviles intactas. RecommendationsPage se queda en cards (texto libre
multi-línea; truncado está en S6). RED→GREEN 26 tests de lógica pura.
Suite 139/139. Commit `4a4748f4`.

**L8** T4 (parent inline) GREEN en S5a-b: `ErrorBanner` + `toErrorState`
(401/403 → "Acceso restringido"; resto → fallo transitorio honesto; title
override para acciones); 7 páginas cableadas con retry (reload/load),
deletes sin `alert()` ni filas stale (Customers/Conversations/Catalog con
banner inline), Dashboard pierde el copy incorrecto "solo en desarrollo";
drawer con Escape, focus trap, restore, scroll lock y aria-expanded/controls.
RED→GREEN 11 tests (`ErrorBanner`, `AdminLayoutDrawer`). Un tsc rojo post-cableado
(setError leftover en Catalog delete) corregido antes del commit. Suite
final 150/150, tsc limpio, build OK. Commit `a3a1dcde`.

**L9** Hallazgos para el usuario (no bloqueantes, fuera de alcance S6):
la segunda foto de About (`photo-1505576399279`) devuelve **404 en Unsplash**
— la imagen está rota en producción desde antes; conviene reemplazarla.
El botón de enviar email del results phase ya no es icon-only sin nombre
(inline follow-up de T2). Copy voseo/tú mezclado sigue pendiente (S6).

**L10** Delivery: issue **#22** (`status:approved`), PR **#23**
`feat(ui): a11y, honest admin error states, performance bundle and shared
DataTable`, branch `feat/ui-optimization`, label `type:chore` (único
type:* disponible en el repo). CI: Backend pass, Frontend (test + typecheck
+ build) pass, GitGuardian pass. Merge y deploy siguen siendo decisión del
usuario.
