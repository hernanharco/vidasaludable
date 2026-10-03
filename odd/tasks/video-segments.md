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
- _(append hashes as tasks close)_

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

## Verification log (T3–T4)

- `vitest video-service + guidance`: 31/31 PASS (RED observed first).
- `tsx src/db/migrate.ts` twice: PASS (idempotent, tables/columns/indexes/FKs PRAGMA-checked).
- `tsc -p tsconfig.json` (backend build): PASS.
- `vitest reconsent.integration`: PASS. `vitest assessment.integration`: 2/9 FAIL —
  **pre-existing, unrelated** (`assessment_responses` DDL has composite PK without
  `id`, Drizzle declares autoincrement `id`; both lines predate this feature —
  follow-up task outside this feature).
- `gentle-ai-verify` subagent unusable this session (2 internal assistant errors);
  verification rerun inline as declared fallback.

## Progress
- T1 done: feature plan + branch — `6b7bd7f3`
- T2 done: permission checklist — `5cd16bbd`
- T3 done: DB tables — `2006897a` (reviewed + approved)
- T4 done: service/matcher/tests — `e5a79cf8` (reviewed + approved)
- T5 next: pipeline CLI (delegated next).


## Decisions

- Physical clips chosen by owner (with permission gate); logical deep links as
  pre-permission fallback — the chat never depends on a clip existing.
- `[VIDEO:<id>]` markers stay in the persisted reply (same pattern as product
  `[REF]`s); the widget resolves them from `GET /assistant/videos` fetched at
  boot, so historical messages keep rendering cards after reload.
- Condition normalization: case/accents/synonyms → `assessment_symptoms`
  (source of truth: `backend/src/seed/assessment_seed_data.json`); unmatched
  segments keep `condition=NULL` and require admin assignment before approval.
