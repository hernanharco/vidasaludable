# Feature: chat-card-ux (advisory backlog Batch 2)

Source: `odd/tasks/advisory-backlog.md` — Batch 2 (findings 2.1–2.3), chat UX /
content-honesty items from the catalog-video-products reviews. Branch:
`fix/chat-card-ux` (from `fix/backend-quick-wins`, stacked).

## Tasks

| # | Task | Edit surfaces | Verification |
|---|------|---------------|--------------|
| T1 | 2.1 `R3-DisclaimerNeverRendered`: ProductCard renders the product `disclaimer` (already in `ProductCardInfo` + served by GET /assistant/products) as a muted line under benefits | `frontend/src/app/components/chat/**`, `frontend/test/**` | RED: test asserting disclaimer text appears in rendered card → GREEN |
| T2 | 2.2 `R3-DuplicateRefsRenderTwice`: within one message, the same `[REF]` renders its ProductCard only once (text occurrences stay) | `frontend/src/app/components/chat/**`, `frontend/test/**` | RED: test with `[121576] … [121576]` expects 1 card, 2 kept tokens → GREEN |
| T3 | 2.3 `R3-VideoUrlAcceptedWithoutSchemeValidation`: VideoCard only renders `href` when `url` starts with `https://` (defense in depth; server builds URLs today) | `frontend/src/app/components/chat/**`, `frontend/test/**` | RED: test with `javascript:` url renders no href (card not clickable) → GREEN |
| T4 | Full verification: frontend suite + build | none | `pnpm vitest run` green, `pnpm build` clean |

## Progress

- [x] T1 — RED `Unable to find an element with the text: Complemento alimenticio…` → GREEN; + blank/missing disclaimer guard test
- [x] T2 — RED `expected … to have a length of 1 but got 2` → GREEN; + per-message scope guard test (2 messages × same ref → 2 cards)
- [x] T3 — RED `expected <a href="javascript:alert(1)"> to be null` → GREEN; shared `body` fragment, https path keeps href/target/rel
- [x] T4 — frontend suite **52/52** (baseline 46 + 6 new), `pnpm build` clean (7.2s, only pre-existing chunk warning)

## Evidence (commits per task)

- T1: `642c8628` fix(chat): render product disclaimer (R3-DisclaimerNeverRendered)
- T2: `5d52406f` fix(chat): dedupe repeated [REF] cards per message
- T3: `1906c09c` fix(chat): https-only href guard (R3-VideoUrlAcceptedWithoutSchemeValidation)
- Verification: worker RED/GREEN evidence per task; parent re-ran full
  suite + build inline as fallback (gentle-ai-verify subagent failed 3×
  with assistant-side errors across this session)

## Decisions

- Disclaimer renders only when non-empty (old rows / curation gaps must not
  break the card) — content honesty: never fabricate, never hide what exists.
- Dedupe is per-message render only; persisted text keeps every `[REF]`
  occurrence (append-only conversation contract, mirrors VIDEO marker rule).
- Scheme guard is `startsWith("https://")` on the client even though
  `resolveSegmentUrl` only builds youtube https URLs today — cheap permanent
  backstop against a future URL source.
