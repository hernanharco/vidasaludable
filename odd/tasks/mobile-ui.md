# Mobile UI — public web + admin panel

Make the public site and the `/admin` panel usable on a 360–430px phone.
Scope is the P1 findings of a read-only mobile audit; P2 polish is explicitly out of scope.

## Specs

**S1 — original request (verbatim)**
> genial. ahora miremos la UI para movil y miremos que debemos que mejorar.
> tanto en la web como en el /admin

**S2 — scope decision (verbatim)**
> Ambos: web + admin — "Arreglo los 7 P1 de la web pública y los 5 P1 del admin. Es el trabajo completo, en dos unidades separadas."

**S3 — admin strategy decision (verbatim)**
> (a) Scroll + sidebar colapsable — "Tablas con overflow-x-auto y min-w, sidebar como drawer en móvil. ~40 líneas, mantiene una sola implementación."

**S4 — chat inputs must not trigger iOS zoom (web)**
Every text input in the chat/registration flow is `text-sm` (14px). iOS Safari auto-zooms on focus below 16px. `frontend/src/app/components/chat/AccessCodeGate.tsx:5,113` is the worst case: `text-sm` **plus** `autoFocus`, so `/chat` opens already zoomed on every visit. Also `ChatInput.tsx:20`, `ChatIntake.tsx:33,147`, `RegistrationGate.tsx:29-32`.
Required: inputs render at 16px below `md` and keep the current `sm` appearance at/above `md` (`text-base md:text-sm`). Drop `autoFocus` from AccessCodeGate.

**S5 — Navbar tap targets (web)**
`frontend/src/app/components/Navbar.tsx:65-70` hamburger button has no padding (24px target); `:81-95` menu links are `block text-sm` with no vertical padding (~20px targets).
Required: hamburger and mobile menu links reach ~44px tap height.

**S6 — Chat header close button (web)**
`frontend/src/app/components/chat/ChatHeader.tsx:19-23` is the only exit from the `/chat` route and is an un-padded 20px `X`.
Required: close control reaches ~44px tap area.

**S7 — Hero stats must not clip (web)**
`frontend/src/app/components/Hero.tsx:62` uses `flex gap-8`; the uppercase labels "RECOMENDACIONES" and "PREVENTIVO" are single unbreakable words wider than their flex base and get clipped by the section's `overflow-hidden`.
Required: the three stats stack vertically below `sm` and lay out in a row at `sm` and up.

**S8 — Admin shell must collapse on mobile (admin)**
`frontend/src/app/admin/AdminLayout.tsx:117-121` fixes the sidebar at `w-16`/`w-64` with no responsive class anywhere in the file; on a 360px viewport ~40px of content remains, and the root `overflow-hidden` (`:115`) prevents rescuing it by page scroll. `:183` and `:194` hard-code `px-8`.
Required: sidebar is hidden below `md` and shown as a toggleable slide-over drawer; the header exposes the toggle; content padding is `px-4 sm:px-8`. Desktop behaviour (collapse toggle at `:163`) is preserved.

**S9 — Admin tables must scroll horizontally (admin)**
Five tables sit in `overflow-hidden` cards with no scroll wrapper, so columns are clipped and the action buttons unreachable: `AssessmentAdminPage.tsx:431,539,647,749` and `ReferrersPage.tsx:191` (plus the nested table at `:294`).
Required: each of those tables scrolls horizontally (`overflow-x-auto` wrapper) with a `min-w-` so columns stop collapsing. No table may lose any column or action.

**S10 — Dashboard header must wrap (admin)**
`frontend/src/app/admin/dashboard/Dashboard.tsx:201-226` is `flex items-center justify-between` with no wrap, so title + blocked badge + "Actualizar" overflow once the sidebar stops consuming width.
Required: the header wraps instead of overflowing.

**S11 — Referrers filters must not trigger iOS zoom (admin)**
`frontend/src/app/admin/ReferrersPage.tsx:212-218` sets `className="text-sm"` on three inline inputs, overriding the shadcn base which already handles the breakpoint correctly (`frontend/src/app/components/ui/input.tsx:11`).
Required: the inline `text-sm` is removed so the base `text-base md:text-sm` applies.

## Tasks

| ID | Spec | Route | Commit |
|----|------|-------|--------|
| T1 | S4-S7 | writer (web components) | _pending_ |
| T2 | S8-S11 | writer (admin) | _pending_ |

## Log

**L1** (user request, verbatim)
> genial. ahora miremos la UI para movil y miremos que debemos que mejorar.
> tanto en la web como en el /admin

**L2** Two read-only audits were delegated (`gentle-ai-explore`, disjoint surfaces) and returned path:line evidence. Public web: 7 P1 + 8 P2. Admin: 5 P1 + 6 P2. Verdict on the admin: strategy (a) — horizontally scrollable tables plus a collapsible sidebar — beats per-table card layouts (would double 12 tables' sort/edit/delete UX) and beats a desktop-only notice (the fix is ~40 lines).

**L3** User scope decision: **both** web + admin; P1 only. P2 polish (break-words, safe-area insets, `loading="lazy"`, `min-h-11` on secondary buttons, PurchasesChart tick overlap, admin `min-w-` on the 8 tables that already scroll) is **deferred**, tracked nowhere, and can be requested later.

**L4** User admin strategy decision: **(a)** scroll + collapsible sidebar, one implementation, no duplicate card layouts, no desktop-only notice.

**L5** Test policy: these are pure Tailwind class changes. jsdom does not compute CSS, so a RED test would only assert a className substring — brittle and low value. Verification is therefore proportionate structural verification (grep the resulting classes) plus the existing 102-test suite and `tsc`/`vite build`, per the non-testable-change path.
