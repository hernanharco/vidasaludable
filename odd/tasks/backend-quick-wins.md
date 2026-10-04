# Feature: backend-quick-wins (advisory backlog Batch 1)

Source: `odd/tasks/advisory-backlog.md` — Batch 1 (findings 1.1–1.4), the four
verified backend quick wins left advisory after the video-segments reviews.
Branch: `fix/backend-quick-wins`.

## Tasks

| # | Task | Edit surfaces | Verification |
|---|------|---------------|--------------|
| T1 | Add `video_segments_video_id_idx` on `video_segments(video_id)` in migrate.ts DDL (R3-002) | `backend/src/db/migrate.ts`, `backend/test/` | RED: test asserting index exists via sqlite_master fails → GREEN: DDL added; migrate ×2 idempotent |
| T2 | TOCTOU duplicate youtubeId (admin.ts:308-310): catch UNIQUE-constraint violation from the insert → 409 (race loser no longer 500) | `backend/src/routes/admin.ts`, `backend/test/` | RED: simulate race (bypass pre-check, direct duplicate insert through route path) → GREEN: 409 |
| T3 | removeVideo FK race (videoService.ts:75-78 / admin DELETE): catch FK violation → 409 instead of 500 | `backend/src/routes/admin.ts`, `backend/test/` | RED: race-simulating test → GREEN: 409 with same body as pre-check |
| T4 | Add `-y` to `buildFfmpegArgs` (overwrite flag) + update verbatim-args test | `backend/src/tools/media.ts`, `backend/test/video-pipeline.test.ts` | RED: updated exact-args assertion fails → GREEN |

## Progress

- [x] T1 — worker: RED `expected undefined to be 'video_segments_video_id_idx'` → GREEN; new `backend/test/migrate-indexes.test.ts` (index + migrate ×2 idempotent; `--` comments only after a `//`-in-SQL mid-course fix)
- [x] T2 — worker: catch UNIQUE/`SQLITE_CONSTRAINT*` → 409 `{"error":"youtubeId already exists"}` in POST /videos; service test pins raw error shape + concurrency triangulation test (one 201 + one 409). RED justified (race unreachable without mocks — synchronous better-sqlite3, no await between pre-check and insert)
- [x] T3 — worker: catch `FOREIGN KEY constraint failed` → re-counted 409 `{"error":"video has segments",count}` in DELETE /videos/:id; service test pins raw FK shape + rollback survival. RED justified (same unreachability)
- [x] T4 — worker: RED updated exact-array asserts → GREEN `-y` first in `buildFfmpegArgs`; both verbatim literals updated (incl. createFfmpegClient cut test)
- [x] Full verification — worker 199/199 + tsc clean, independently re-run by
  parent (verify subagent failed twice with assistant-side errors, fallback
  inline): 199/199 ×2, migrate-indexes ×2, build exit 0

## Evidence (commits per task)

- T1: `85cd8f41` fix(db): index video_segments(video_id) (R3-002)
- T2+T3: `3868f3a5` fix(admin): UNIQUE/FK races → 409 (same route file, one unit)
- T4: `763884f0` fix(media): `-y` first in buildFfmpegArgs
- Verification: backend **199/199** ×2 consecutive runs + migrate-indexes ×2
  green + `pnpm build` (tsc) exit 0. Note: delegated gentle-ai-verify failed
  twice with an assistant-side error (not command failures); parent re-ran the
  checks inline as fallback.

## Decisions

- T2/T3 fix the *error mapping* of the race, not the race itself: SQLite
  unique/FK constraints already guarantee correctness (one row / no orphan
  delete); the defect was surfacing the constraint error as 500. Pre-checks
  stay as the friendly fast path.
- `-y` removes the documented operational caveat (re-cut no longer requires
  manually deleting `backend/data/clips/<videoId>/` first).
