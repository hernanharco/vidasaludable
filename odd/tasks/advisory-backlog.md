# Advisory Backlog — triage (2026-10-04)

Cross-feature inventory of the advisory (non-blocking) findings left after the
approved native reviews of `video-segments` and `catalog-video-products`.
Source docs: `odd/tasks/video-segments.md`, `odd/tasks/catalog-video-products.md`.

**Total inventoried: 59** — video-segments 36 (T3-4: 6 · T5: 17 · T6: 2 ·
T7: 1 · T8: 5 · T9: 3 · post-approval: 2) + catalog-video-products 23
(T1: 15 · T2: 3 · T4: 2 · T5: 2 · T6: 1).

Status legend: `open` = verified still present · `verify` = likely mitigated,
needs one confirmation · `accept` = informational, keep as-is.

## Batch 1 — Backend quick wins (low risk, < 1h total)

| # | Finding | Sev | Status | Notes |
|---|---------|-----|--------|-------|
| 1.1 | `R3-002` video_segments lacks video_id index (migrate.ts:157-172) | WARNING | open | Confirmed: only `enabled_idx` + `condition_idx` exist; every segment-per-video query joins on `video_id`. 1-line DDL. |
| 1.2 | `R3-TOCTOU-DUP-YOUTUBEID` check-then-insert race (admin.ts:308-310) | WARNING | open | Unique index guarantees one row, but the loser gets an unhandled 500 instead of 409. Catch UNIQUE → 409. |
| 1.3 | `R3-001` removeVideo FK-ordering hazard (videoService.ts:75-78) | WARNING | open | DELETE route counts segments first (409), but a race between count and delete surfaces FK error as 500. Catch FK → 409. |
| 1.4 | ffmpeg args lack `-y` (media.ts buildFfmpegArgs) — operational caveat documented in video-segments report | WARNING | open | Re-cut currently requires manually deleting `backend/data/clips/<videoId>/`. Add `-y` + update the verbatim-args test. Removes a known footgun. |

## Batch 2 — Chat UX / content honesty (frontend, small)

| # | Finding | Sev | Status | Notes |
|---|---------|-----|--------|-------|
| 2.1 | `R3-DisclaimerNeverRendered` — ProductCard never shows the product disclaimer (T6) | SUGGESTION | open | Confirmed: ProductCard renders benefits but not `disclaimer`. Content-honesty rule makes this worth taking: benefits claim without the disclaimer line. |
| 2.2 | `R3-DuplicateRefsRenderTwice` — same `[REF]` cited twice renders two cards (T5) | SUGGESTION | open | Confirmed in ChatMessages.tsx split logic. Dedupe per message (keep text occurrences, render card once). |
| 2.3 | `R3-VideoUrlAcceptedWithoutSchemeValidation` (VideoCard.tsx:13) | WARNING | verify | `url` is server-built by `resolveSegmentUrl` → always `https://www.youtube.com/...` and `youtubeId` is `[\w-]+`-validated. Frontend `startsWith("https://")` guard closes it permanently. |

## Batch 3 — Admin videos page (tests + patch semantics)

| # | Finding | Sev | Status | Notes |
|---|---------|-----|--------|-------|
| 3.1 | `R3-EDIT-DELETE-COVERAGE` VideosPage.test.tsx:145-311 (T9) | WARNING | done | Edit/delete flows lack test coverage. Covered by 2d2e8df0. |
| 3.2 | `R3-SEGMENT-EDIT-PATCH-SEMANTICS` VideosPage.tsx:204-209 (T9) | WARNING | done | Edit patch: symptomId-vs-condition priority + clip null semantics pinned at component level by 2d2e8df0. |
| 3.3 | `R3-STALE-SEGMENT-FILTER` VideosPage.tsx:135-136 (T9) | SUGGESTION | done | Real bug: filter went stale after video delete. Fixed + RED→GREEN test in 2d2e8df0. |
| 3.4 | `R3-MissingBackendTests` assessmentService.ts:175 + `R3-ReadPathReconstruction` assessmentService.ts:216 (post-approval) | SUGGESTION | done | Reconstruction contract pinned in bd31df8b (recomputed weights vs historical score/status); suite at 200 tests. |

## Deferred — Pipeline CLI robustness (T5, 17 findings)

Owner-run tooling only (`yt-dlp`/`ffmpeg`/Gemini analyzer), never public
surface. WARNINGs: R1-001 videoPipeline.ts:82-96 · R2-cli-branch-duplication
:341-374 · R2-db-path-convention :349-350 · R2-direct-exec-guard :429 ·
R2-list-then-filter :236-243 · R2-signal-code-127 media.ts:39-43 ·
R2-update-readback :262-263 · R3-non-numeric-error-code-mapping media.ts:42 ·
R3-rerun-path-untested :166-178 · R4-001 media.ts:37 · R4-002 media.ts:166-170 ·
+ 6 SUGGESTIONs. Take as one dedicated work unit the next time the pipeline
changes; error-code mapping (signal vs numeric) and update-readback are the
two with real failure-mode value.

## Accept as-is (informational)

- **T1 catalog extraction (15)**: one-off PriceList extraction script, already
  run and verified (78 rows / 75 flagged). Details were counted at review time
  but not individually inventoried — value of re-litigating a finished script ≈ 0.
- **T6 analyzer tests (2)**: empty-condition boundary + weak hard-limit
  assertion — test-precision nits.
- **T8 (5, minus 2.3 above)**: spelling assertions, import-outside-candidate,
  EndToEndMarkerResolution, `infoSummary` field never rendered — informational.
- **R3-003..006 (4)**: videoService:68 refactor + 2 test-structure + 
  symptomMatcher:39 — suggestions.
- **T5 catalog: `R3-ColloquialPairingNeverRenders`** — believed addressed by
  the analyzer-prompt rewording recorded in T5 evidence ("link by
  correspondence, strict ref validation kept"); pilot went 0 → 12 linked refs.
  Verify against a future analyze run, no code change pending.
- **`R3-BACKEND-FORMAT-DUPLICATION` / `R3-PARTIAL-TIME-PAYLOAD` (T4, 2)**:
  formatTime duplication backend/frontend is deliberate (raw seconds contract);
  partial payload is backward-compat by design.
- **T2 (3: PDPFALLBACK, PDPWIRING, SCOREPRICE)**: scoring price already fixed
  (17c2d1c6); PDP fallback/wiring nits in the curation scripts.
- **T5 media/test SUGGESTIONs (6)**: console.warn in pure parser, import-meta
  guard, magic test ids, unused readdir, exit-code classification — polish.

## Progress

- [x] Batch 1 (1.1-1.4) — commits 85cd8f41 · 3868f3a5 · 763884f0 (branch
  fix/backend-quick-wins; see odd/tasks/backend-quick-wins.md)
- [x] Batch 2 (2.1-2.3) — commits 642c8628 · 5d52406f · 1906c09c (branch
  fix/chat-card-ux; see odd/tasks/chat-card-ux.md)
- [x] Batch 3 (3.1-3.4) — commits 2d2e8df0 · bd31df8b (branch
  fix/admin-videos-tests; see odd/tasks/admin-videos-tests.md)
- [ ] Batch 2 (2.1-2.3)
- [ ] Batch 3 (3.1-3.4)
- [ ] Deferred pipeline batch
