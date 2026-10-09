# Feature: chat-ui-redesign (ruta /chat dedicada + señalética IA + móvil)

## User decisions (2026-10-09)

- **Estructura**: ruta **`/chat` dedicada** a pantalla completa (tipo
  Messenger), en lugar del popup flotante de 440×384 px. URL propia,
  accesible desde el botón de la landing.
- **Señalética IA**: icono **`Sparkles`** + label **"Análisis IA"**. Header
  del chat: "Análisis IA" / "Listo para analizar". Se elimina toda la señal
  de asesor humano.

## Problem (3 puntos reportados por el usuario)

1. **El botón no comunica "IA que analiza"**: `MessageCircle` (burbuja de
   habla) + header con icono `User` + "Recomendador Preventivo" + "En línea".
   Tres señales de asesor humano, cero de análisis automático. Su esposa lo
   leyó como "voy a hablar con un asesor, no con la IA".
2. **Móvil roto**: `absolute bottom-16 right-0 w-80 h-[440px]` sin ninguna
   media query (el único breakpoint es `sm:w-96`). `h-[440px]` fijo se sale
   por arriba en pantallas bajas; `w-80` deja 40px de margen en celus de
   360px; sin `env(safe-area-inset-*)` para el notch de iOS.
3. **Chat chico**: 440×384 px para un intake de 5 pasos + conversación larga
   con tarjetas de producto y video. No entra cómodo.

## Design

```
Landing (/)                     Chat (/chat)
┌──────────────────────┐        ┌───────────────────────────┐
│ Navbar               │        │ ✨ Análisis IA      (top) │
│                      │        ├───────────────────────────┤
│ Hero…                │        │                           │
│                      │        │  conversación a pantalla  │
│        ┌──────────┐  │  click │  completa, scroll propio   │
│        │✨Análisis│──┼──────▶ │  max-w-3xl centrado       │
│        │    IA    │  │        │  [tarjeta producto]        │
│        └──────────┘  │        │                           │
└──────────────────────┘        ├───────────────────────────┤
  ChatLauncher (navega)         │  Escribí tu mensaje…  ➤  │
                                └───────────────────────────┘
                                  safe-area + full height
```

### Componentes

| Componente | Rol |
|---|---|
| `ChatSession.tsx` (nuevo) | Toda la lógica de fases (access_code → gate → intake → chat) + render del cuerpo. **Extraído de `ChatWidget`** sin cambiar comportamiento. Sin `isOpen`. |
| `ChatPage.tsx` (nuevo) | Layout Messenger de la ruta `/chat`: header sticky `Sparkles`, área de mensajes scrollable con `max-w-3xl`, input sticky abajo. Monta `ChatSession` + `AssessmentWidget`. |
| `ChatLauncher.tsx` (nuevo) | Botón flotante `Sparkles` + "Análisis IA" → `navigate("/chat")`. Reemplaza al `ChatWidget` de la landing. |
| `ChatWidget.tsx` | Se vacía: su lógica pasa a `ChatSession`. Queda como export deprecated o se elimina (decisión por tarea). |
| `ChatHeader.tsx` | `Sparkles` en vez de `User`; "Análisis IA" / "Listo para analizar". |
| `App.tsx` | Nueva `<Route path="/chat" element={<ChatPage/>}>`; `Landing` monta `ChatLauncher`. |

### Móvil (T2)

- La ruta `/chat` es fullscreen por definición → se resuelve `h-[440px]` y
  `w-80`.
- `min-h-[100dvh]` (no `100vh` — la toolbar del móvil) + `padding-bottom:
  env(safe-area-inset-bottom)` en el input.
- Header sticky; área de mensajes `flex-1 overflow-y-auto`.
- Breakpoints: nada de `w-80` — el ancho es `100%` con `max-w-3xl` interno.

### Impacto en tests existentes (4 archivos)

`AssessmentCard`, `ChatIntake`, `ProductCards`, `VideoCards` hacen
`render(<ChatWidget/>)` + `user.click(getByRole("button"))` para abrir. Al
extraer `ChatSession` pasan a montarlo directo (sin click). Cambio mecánico
de import + setup, misma lógica assertion.

## Tasks

| # | Task | Edit surfaces | Verification |
|---|------|---------------|--------------|
| T1 | Refactor: extraer `ChatSession.tsx` de `ChatWidget.tsx` (fases + render intactos) y migrar los 4 tests existentes | `frontend/src/app/components/chat/**`, `frontend/test/AssessmentCard.test.tsx`, `frontend/test/ChatIntake.test.tsx`, `frontend/test/ProductCards.test.tsx`, `frontend/test/VideoCards.test.tsx` | Todos los tests existentes verdes (sin perder cobertura), `tsc` limpio. RED primero si se añade test nuevo. |
| T2 | `ChatPage.tsx` + ruta `/chat` + layout Messenger fullscreen responsive con safe-area + montar `AssessmentWidget` | `frontend/src/app/components/chat/ChatPage.tsx`, `frontend/src/app/App.tsx`, `frontend/test/ChatPage.test.tsx` | RED: test de ruta (renderiza `/chat`, header sticky, input visible, scroll) → GREEN; `tsc` limpio |
| T3 | Señalética IA: `ChatLauncher` (Sparkles + label → navega), `ChatHeader` con Sparkles/"Análisis IA", reemplazar `ChatWidget` en Landing | `frontend/src/app/components/chat/ChatLauncher.tsx`, `ChatHeader.tsx`, `ChatWidget.tsx`, `frontend/src/app/App.tsx`, `frontend/test/ChatLauncher.test.tsx` | RED: test (launcher muestra Sparkles + "Análisis IA", click navega a `/chat`; header dice "Análisis IA" y no "En línea") → GREEN |
| T4 | Verificación E2E local + docs (`odd/tasks/chat-ui-redesign.md`, README si aplica) | `odd/tasks/chat-ui-redesign.md` | suites verdes, `pnpm build` limpio, smoke manual en `/` y `/chat` (desktop + viewport móvil) |

## Progress

- [x] T1 — refactor sin cambio de comportamiento; suite 9/86 idéntica al
  baseline, tsc limpio, build 10.05s (worker: `ChatSession.tsx` 538 líneas
  con estado/efectos/handlers verbatim; `ChatWidget.tsx` a wrapper de 54
  líneas con clases byte-idénticas; 4 tests migrados a montar `ChatSession`;
  el widget-level test de AssessmentCard se queda en `ChatWidget` porque su
  contrato es el interplay popup↔modal). Desviaciones forzadas: `ChatSession`
  acepta `onClose` porque `ChatHeader` lo exige; sin `loading`/`welcome` ni
  backdrop (no existen en el código actual, la spec estaba desactualizada).
- [x] T2 — RED 4/4 failed → GREEN 4/4; suite 10 files / 90 tests; tsc limpio;
  build 16.71s (worker: `ChatPage.tsx` con `min-h-[100dvh] h-[100vh]
  supports-[height:100dvh]:h-[100dvh]` + `pb-[env(safe-area-inset-bottom)]`,
  ruta `/chat` en App.tsx, `AssessmentWidget` montado en la página). Hallazgo
  importante: **Tailwind v4 emite `.h-[100dvh]` ANTES de `.h-[100vh]`** en el
  CSS construido, así que un `h-[100dvh]` simple perdía la cascada contra el
  fallback y reintroducía el scroll fantasma — por eso el variant
  `supports-[height:100dvh]:`. Verificado en el build: el bloque
  `@supports (height:100dvh)` sí se emite.
- [x] T3 — RED 4/4 failed → GREEN 4/4; suite 11 files / 94 tests; tsc limpio;
  build 13.97s; `GET /chat` → 200 en el dev server (worker: `ChatLauncher.tsx`
  nuevo con `Sparkles` + label "Análisis IA" + `navigate("/chat")` +
  `aria-label`, `ChatHeader` con `Sparkles`/"Análisis IA"/"Listo para
  analizar", `ChatPage` cablea `onClose→navigate("/")` cerrando el gap de T2,
  **`ChatWidget.tsx` eliminado**, landing solo con el launcher, test
  widget-level de AssessmentCard migrado a `ChatSession`+`AssessmentWidget`).
- [x] T4 — smoke E2E por curl contra el dev server con data de producción:
  `GET /chat` → 200, `POST referrer/validate` con el código real
  `1906432239` → `{valid:true, Hernan Arango Cortes}`, consent v1, 16
  productos disponibles para las cards. Limpieza: comentarios stale que
  mencionaban `ChatWidget` corregidos en `ChatSession.tsx`/`types.ts` y los
  `describe` titles de 3 tests. Verificado por el padre: `ChatWidget.tsx`
  inexistente, sin `User`/"En línea"/"Recomendador Preventivo" en el código
  vivo, tsc limpio, 94/94.

## Smoke visual PENDIENTE del usuario

Las verificaciones automatizadas cubren estructura, tipos, tests y endpoints,
pero **NO el layout real**: jsdom no calcula layout ni medidas. Falta revisar
en el navegador: (1) el botón ✨Análisis IA en `/`, (2) `/chat` a pantalla
completa en desktop, (3) `/chat` en un celu real (safe-area, header sticky,
input no tapado por el home indicator), (4) el intake de 5 pasos y (5) el
wizard `[ASSESSMENT]` desde el chat.

## Evidence (commits per task)

## Decisions

- **Ruta dedicada sobre panel flotante** (decisión del usuario): el popup de
  440px no daba espacio; una ruta da URL propia, historial del navegador y
  fullscreen nativo en móvil sin hacks de altura.
- **`100dvh` y no `100vh`** en móvil: `100vh` incluye la toolbar del
  navegador y hace scroll fantasma.
- **`ChatSession` extraído sin cambio de comportamiento en T1** para que los
  tests sigan siendo la red de seguridad del refactor antes de tocar layout.
- `AssessmentWidget` vive solo en `/chat`, montado por `ChatPage`, porque el
  marcador `[ASSESSMENT]` vive dentro de la conversación.
- **Decisión del usuario (2026-10-09)**: quitar `AssessmentWidget` de la
  landing. Con el chat en `/chat`, el marcador `[ASSESSMENT]` no existe en la
  landing, así que el widget quedaba montado sin ningún disparador. La
  landing queda con un único punto de entrada: el botón ✨Análisis IA. El
  chequeo de 95 síntomas se abre solo desde dentro del chat.
- **Riesgo B de T1 aceptado**: cerrar el popup desmonta `ChatSession` y
  pierde el estado en memoria sin guardar (mitad del intake/formulario). Se
  auto-resuelve en T2/T3 — el popup sale de la landing y `ChatSession` vive
  en la página `/chat`, que no se desmonta al cerrar nada. La conversación
  persistida ya se restaura vía `GET /assistant/history`.
- **Riesgo A de T1 aceptado**: el prefetch de videos/products ahora ocurre al
  montar `ChatSession` en vez de al cargar la página. Es correcto: son
  best-effort y solo los consume el chat.
- **Archivos acoplados entre tareas**: `index.ts` y `App.tsx` los tocan T2 y
  T3; `AssessmentCard.test.tsx` los tocan T1 y T3; `ChatPage.tsx` los tocan T2
  y T3. No se puede partir por tarea sin `git add -p` y dejar cada commit
  compilando, así que T1+T2+T3 van en **un único commit de rediseño** (mismo
  que en chat-intake, por la misma razón técnica).
- **Comentarios que mencionan `ChatWidget`**: se conservan solo los que
  documentan el cambio ("Replaces the old ChatWidget launcher", "T3 removed
  the popup ChatWidget"); se corrigieron los que describían el código actual.
