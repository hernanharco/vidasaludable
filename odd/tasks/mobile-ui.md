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
| T1 | S4-S7 | writer (web components) + inline completion of the AccessCodeGate surface gap | `6e4a1f83` |
| T2 | S8-S11 | writer (admin) | `3d943571` |

## Log

**L1** (user request, verbatim)
> genial. ahora miremos la UI para movil y miremos que debemos que mejorar.
> tanto en la web como en el /admin

**L2** Two read-only audits were delegated (`gentle-ai-explore`, disjoint surfaces) and returned path:line evidence. Public web: 7 P1 + 8 P2. Admin: 5 P1 + 6 P2. Verdict on the admin: strategy (a) — horizontally scrollable tables plus a collapsible sidebar — beats per-table card layouts (would double 12 tables' sort/edit/delete UX) and beats a desktop-only notice (the fix is ~40 lines).

**L3** User scope decision: **both** web + admin; P1 only. P2 polish (break-words, safe-area insets, `loading="lazy"`, `min-h-11` on secondary buttons, PurchasesChart tick overlap, admin `min-w-` on the 8 tables that already scroll) is **deferred**, tracked nowhere, and can be requested later.

**L4** User admin strategy decision: **(a)** scroll + collapsible sidebar, one implementation, no duplicate card layouts, no desktop-only notice.

**L5** Test policy: these are pure Tailwind class changes. jsdom does not compute CSS, so a RED test would only assert a className substring — brittle and low value. Verification is therefore proportionate structural verification (grep the resulting classes) plus the existing 102-test suite and `tsc`/`vite build`, per the non-testable-change path.

**L6** T1 stopped on a genuine spec defect rather than guessing: S4 named the target as `chat/AccessCodeGate.tsx`, but that path does not exist. The real file is `frontend/src/app/components/AccessCodeGate.tsx` (one level up, outside the delegated `chat/**` surface); its `inputCls` (:5) and `autoFocus` (:113) matched the spec exactly, so the intent was unambiguous. The parent extended the surface and completed the two edits inline instead of paying a full worker round-trip. **Correction to S4**: the correct path is `frontend/src/app/components/AccessCodeGate.tsx`.

**L7** Deliberate non-actions: the writer did not adopt `ui/sheet.tsx` for the admin drawer — Sheet portals into a dialog with its own focus management, which would duplicate the nav DOM instead of simplifying it. Escape-key close / focus trap / scroll lock for the drawer are P2 polish and stay out of scope (L3). The other 8 admin tables already scroll and were left alone.

**L8** Evidence — structural verification of every spec:
- S4: `text-base md:text-sm` present at all 5 input sites (`AccessCodeGate.tsx:5`, `ChatInput.tsx:20`, `ChatIntake.tsx:34`, `RegistrationGate.tsx:29,32`); `autoFocus` count in AccessCodeGate is 0.
- S5: `Navbar.tsx` hamburger `p-2.5`, mobile links `py-2.5 min-h-11`.
- S6: `ChatHeader.tsx:22` → `p-3 rounded-full flex items-center justify-center`, `onClick` preserved.
- S7: `Hero.tsx:62` → `flex flex-col gap-4 sm:flex-row sm:gap-8`.
- S8: `AdminLayout.tsx` backdrop `fixed inset-0 z-30 … md:hidden` (:122), aside `fixed inset-y-0 left-0 z-40 … md:static` (:132), hamburger `md:hidden p-2` (:210), padding `px-4 sm:px-8` (:204, :225).
- S9: `AssessmentAdminPage.tsx` 4× `overflow-x-auto` + 4× `min-w-[640px]`; `ReferrersPage.tsx` 2× `overflow-x-auto` + 2× `min-w-[720px]` (incl. the nested table).
- S10: `dashboard/Dashboard.tsx:202` → `flex flex-wrap items-center justify-between gap-3`.
- S11: `ReferrersPage.tsx` has 0 remaining `className="text-sm"` overrides.
- Verification: `npx vitest run` 102/102, `npx tsc --noEmit` clean, `npx vite build` OK.

**L9** A11y gap noted by the writer, not fixed (out of scope): `ChatHeader.tsx`'s close button had no `aria-label` before or after this change. The task said "preserve its aria-label" and there was none to preserve. Worth a follow-up.

**L10** Deferred P2 pool, still untracked and available on request: chat bubble `break-words` (`ChatMessages.tsx:198`), safe-area insets (`index.html` lacks `viewport-fit=cover`, so all `env(safe-area-inset-*)` resolve to 0), `loading="lazy"` + responsive heights on `About.tsx` images, `p-6 sm:p-10` on `Services.tsx:41`, `min-h-11` on secondary buttons (`ui/button.tsx:24` is `h-9`), `PurchasesChart.tsx:43-47` tick overlap at 360px, and `min-w-`/truncation on the 8 admin tables that already scroll.

**L11** Delivery: issue **#16** (`status:approved`), PR **#17** `fix(ui): make the public site and the admin panel usable on mobile`, branch `feat/mobile-ui`, label `type:chore` (the repo exposes no `type:bug`/`type:feature`). CI run 38149938731: Backend pass, Frontend (test + typecheck + build) pass, GitGuardian pass. Merge and deploy to production remain the user's decision.

**L12** Still open at close: visual verification on a real mobile device (not possible statically), and the `ChatHeader` close button has no `aria-label` (L9).
