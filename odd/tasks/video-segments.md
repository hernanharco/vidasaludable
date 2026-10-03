# Feature: video-segments

Educational video knowledge module: analyze health-education videos (Luis
Collantes first, more speakers later), extract timestamped segments per
condition (normalized against the 95 assessment symptoms), cut physical clips
for the owner's YouTube channel, and let the chat assistant cite approved
segments with `[VIDEO:<id>]` so the widget renders a link card.

**License gate**: physical clips may only be re-uploaded AFTER written
permission from the content owner. Until then every segment falls back to a
deep link into the ORIGINAL video (`watch?v=<id>&t=<start_s>`), so the chat
feature works from day 1. Reminder checklist: `docs/video-permissions.md`.

**Domain model**

```
videos                      video_segments
├─ speaker (text)           ├─ videoId → videos
├─ youtubeId (original)     ├─ condition (normalized symptom text, nullable)
├─ url                      ├─ symptomId → assessment_symptoms (nullable)
├─ title                    ├─ startS / endS (integer seconds)
├─ durationS                ├─ title / summary
├─ status (draft/analyzed/cut/published)
└─ licenseNote              ├─ clipYoutubeId (owner-channel clip, nullable)
                            ├─ enabled (0|1 — approved for chat injection)
                            └─ createdAt / updatedAt
```

URL resolution: `clipYoutubeId` present → `watch?v=<clip>`; otherwise
`watch?v=<original>&t=<startS>` (fallback, works with no clip uploaded).

## Tasks

| # | Task | Edit surfaces | Verification |
|---|------|---------------|--------------|
| 1 | Tracking + feature branch `feat/video-segments` | `odd/tasks/video-segments.md`, todo | branch exists |
| 2 | Permission reminder doc (license checklist + email template) | `docs/video-permissions.md` | doc committed |
| 3 | DB: `videos` + `video_segments` tables (Drizzle schema + idempotent DDL) | `backend/src/db/schema.ts`, `backend/src/db/migrate.ts` | vitest suite passes; migrate creates tables |
| 4 | `videoService` CRUD + symptom normalizer (match → assessment_symptoms) | `backend/src/services/videoService.ts`, `backend/src/services/symptomMatcher.ts`, `backend/test/video-service.test.ts` | RED→GREEN vitest |
| 5 | Pipeline CLI: transcript ingest (yt-dlp), Gemini segment analyzer, ffmpeg cut builder, `video:analyze`/`video:cut` scripts | `backend/src/tools/**`, `backend/test/video-pipeline.test.ts`, `backend/package.json` | RED→GREEN vitest (parsers/builders), `--help` smoke |
| 6 | Agent: prompt `VIDEOSEGMENTS` block + `[VIDEO:id]` citation rule + `extractVideoRefs` + injection in ask route | `backend/src/agent/prompt.ts`, `backend/src/routes/assistant.ts`, `backend/test/video-agent.test.ts` | RED→GREEN vitest |
| 7 | Public `GET /assistant/videos` (enabled segments with resolved URLs) + admin CRUD/approve routes | `backend/src/routes/assistant.ts`, `backend/src/routes/admin.ts`, `backend/test/admin-videos.test.ts` | vitest |
| 8 | Chat widget: fetch segment map at boot, render `[VIDEO:id]` markers as link cards (strip tokens) | `frontend/src/app/components/chat/**`, `frontend/test/**` | vitest + `pnpm build` |
| 9 | Admin CRM: `VideosPage` (list segments, edit bounds/title/condition, approve, register clip id) + api client + nav | `frontend/src/app/admin/**` | vitest + `pnpm build` |
| 10 | Full verification pass (backend + frontend suites, builds) | none (read-only) | all green |
| 11 | Pilot: run pipeline on `https://www.youtube.com/watch?v=0RYeUT3Yl0Q` (needs `yt-dlp` + `GEMINI_API_KEY`); record the runbook/result in this file if tools unavailable | none (artifacts only) | segments row created OR runbook note |
| 12 | Close: work-unit commits recorded below, native review inspect, report failed/skipped checks | this file | review outcome noted |

## Evidence (commits recorded per task)

- T1: branch `feat/video-segments` + plan — `6b7bd7f3`
- T2: `docs/video-permissions.md` — `5cd16bbd`
- T3: DB tables (schema + DDL) — `2006897a`
- T4: videoService + symptomMatcher + tests — `e5a79cf8`
- T5: pipeline CLI (analyze + cut) — `a953bfa7`
- T6: agent [VIDEO] citations + injection — `880269eb`
- T7: GET /assistant/videos + admin CRUD — `8fbd5c37`
- T8: chat video link cards — `6ed65c88` (+ test rot repair `ee2af621`)
- _(append hashes as tasks close)_

## Native review (T8 candidate)

- Lineage `review-c95f90db5718caf6`, medium, lens `review-reliability`:
  **approved** first capture, authority burned. Target
  `sha256:5b8efeadeedb2f0a55fcc1636e40d53e838da2f120b53cf6ed5c611eb6ae8048`.
- Advisory (5, informational): `R3-AssessmentSpellingAssertionsChangeWithoutComponentChange`
  test:62 · `R3-AssessmentTestImportsComponentOutsideCandidate` test:4 ·
  `R3-EndToEndMarkerResolutionUncovered` VideoCards.test.tsx:139-197 ·
  `R3-VideoCardInfoSummaryFieldNeverRendered` types.ts:22 ·
  `R3-VideoUrlAcceptedWithoutSchemeValidation` VideoCard.tsx:13 (WARNING).

## Native review (T7 candidate)

- Lineage `review-3610e57a2e91a031`, tier medium, lens `review-reliability`:
  **approved** first capture (one consent-binding expiry en route — resolved by
  re-running START per protocol; no lineage lost). Authority burned. Target
  `sha256:bdbdcad61ccf1f87d74c80dbd52dd39c2b65ada62732dc2e458025c6b7de0e48`.
- Advisory (1): `R3-TOCTOU-DUP-YOUTUBEID` WARNING admin.ts:308-310 (check-then-
  insert race on duplicate youtubeId; the unique index still guarantees one row).

## Native review (T6 candidate)

- Lineage `review-d34da6dad66fba33`, tier medium, lens `review-reliability`:
  **approved** (first reviewer payload refused at admission — missing proof
  reference; slot relaunched per protocol, second payload admitted). Authority
  burned. Target `sha256:2465617081426ff8cd750ba8224ffa86516317021b6a56de27cf21c2ddea2f25`.
- Advisory (2, informational): `R3-empty-condition-boundary` video-agent.test.ts:60-61 ·
  `R3-weak-hard-limit-assertion` video-agent.test.ts:114.

## Native review (T5 candidate)

- Lineage `review-fc50eac2d5cdd80c`, tier **high** (`shell_process` in media.ts),
  4 lenses (risk → resilience → readability → reliability): **approved** on the
  first group capture, no corrections; authority burned. Target
  `sha256:ef65bcea05aee8c23e8ecdc53eb4fe0b1caba9312336fd23034461a0de096258`.
- Advisory findings (17, informational — later work only):
  - WARNINGs: `R1-001` videoPipeline.ts:82-96 · `R2-cli-branch-duplication` :341-374 ·
    `R2-db-path-convention` :349-350 · `R2-direct-exec-guard` :429 ·
    `R2-list-then-filter` :236-243 · `R2-signal-code-127` media.ts:39-43 ·
    `R2-update-readback` :262-263 · `R3-non-numeric-error-code-mapping` media.ts:42 ·
    `R3-rerun-path-untested` :166-178 · `R4-001` media.ts:37 · `R4-002` :166-170
  - SUGGESTIONs: `R1-002` parsers.ts:42-45 · `R2-exit-code-classification` :337-340 ·
    `R2-test-magic-ids` test:30-31 · `R2-unused-readdir` test:2 ·
    `R3-console-warn-in-pure-parser` parsers.ts:99 · `R3-import-meta-url-guard` :429
- Known operational caveat: ffmpeg args have no `-y` (spec-fixed array) — re-cut
  requires removing `backend/data/clips/<videoId>/` first (documented in report).

## Native review (T3–T4 candidate)

- Lineage `review-23a1fdc01ae8e36b`, tier medium, lens `review-reliability`:
  **approved** on first capture, no corrections; authority burned
  (`native-approved-acknowledgement-completed`). Target
  `sha256:b5a1eb7298ed477056c26982dcd6dfc5724c97341301d54c980a24095598571e`.
- Advisory findings (informational, NOT blocking; later work only):
  - R3-001 WARNING `backend/src/services/videoService.ts:75-78` (removeVideo FK-ordering hazard)
  - R3-002 WARNING `backend/src/db/migrate.ts:157-172` (video_segments lacks video_id index)
  - R3-003 SUGGESTION `backend/src/services/videoService.ts:68`
  - R3-004 SUGGESTION `backend/test/video-service.test.ts:181-192`
  - R3-005 SUGGESTION `backend/test/video-service.test.ts:194-216`
  - R3-006 SUGGESTION `backend/src/services/symptomMatcher.ts:39`

## Verification log (T3–T5)

- T3–T4: `vitest video-service + guidance` 31/31 · migrate ×2 idempotent · `tsc` PASS ·
  `reconsent.integration` PASS. `assessment.integration` 2/9 FAIL — **pre-existing,
  unrelated** (assessment_responses DDL composite PK vs Drizzle autoincrement id;
  follow-up outside this feature).
- T5: `vitest video-pipeline + video-service` 58/58 PASS (RED first) ·
  `tsx src/tools/videoPipeline.ts --help` exit 0 · `tsc` PASS · CLI misuse smokes
  exit 2/1/127 as specified.
- T6: `vitest video-agent + guard + assistant.integration + catalog` 32/32 PASS (RED
  first, 13 new) · `tsc` PASS.
- T7: `vitest video-endpoints + video-agent + assistant.integration + video-service`
  65/65 PASS (RED first, 23 new) · `tsc` PASS ×2.
- T8: `vitest VideoCards` 8/8 PASS (RED first) · `pnpm --dir frontend build` PASS ×2 ·
  AssessmentWidget suite: 2/9 after entry-point repair, **7 FAIL pre-existing**
  (heading renamed at ccbfaf31, flow changed with access codes 5afb98f3) —
  follow-up OUTSIDE this feature.
- `gentle-ai-verify` subagent unusable this session (2 internal assistant errors);
  verification rerun inline as declared fallback.

## Progress
- T1 done: feature plan + branch — `6b7bd7f3`
- T2 done: permission checklist — `5cd16bbd`
- T3 done: DB tables — `2006897a` (reviewed + approved)
- T4 done: service/matcher/tests — `e5a79cf8` (reviewed + approved)
- T5 done: pipeline CLI — `a953bfa7` (reviewed + approved, 4 lenses)
- T6 done: agent [VIDEO] integration — `880269eb` (reviewed + approved)
- T7 done: video endpoints + admin CRUD — `8fbd5c37` (reviewed + approved)
- T8 done: chat video cards — `6ed65c88` + `ee2af621` (reviewed + approved)
- T9 next: admin CRM VideosPage + api client + nav (delegated next).

## Follow-ups OUTSIDE this feature (pre-existing, need own authorization)
- frontend: AssessmentWidget.test.tsx — 7 heading/flow failures ("Evaluación de
  Deficiencias" renamed, access-code flow).
- backend: assessment.integration 2/9 (assessment_responses DDL PK vs Drizzle id).
- Advisory backlog from reviews R3-001..006 (T3-4), 17 findings (T5), 1 TOCTOU (T7),
  5 findings (T8) — see sections above.


## Decisions

- Physical clips chosen by owner (with permission gate); logical deep links as
  pre-permission fallback — the chat never depends on a clip existing.
- `[VIDEO:<id>]` markers stay in the persisted reply (same pattern as product
  `[REF]`s); the widget resolves them from `GET /assistant/videos` fetched at
  boot, so historical messages keep rendering cards after reload.
- Condition normalization: case/accents/synonyms → `assessment_symptoms`
  (source of truth: `backend/src/seed/assessment_seed_data.json`); unmatched
  segments keep `condition=NULL` and require admin assignment before approval.
