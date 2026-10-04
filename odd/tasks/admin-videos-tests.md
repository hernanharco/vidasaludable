# Feature: admin-videos-tests (advisory backlog Batch 3)

Source: `odd/tasks/advisory-backlog.md` — Batch 3 (findings 3.1–3.4), admin
VideosPage coverage + stale filter + assessment read-path coverage. Branch:
`fix/admin-videos-tests` (stacked on `fix/chat-card-ux`).

## Tasks

| # | Task | Edit surfaces | Verification |
|---|------|---------------|--------------|
| T1 | 3.3 `R3-STALE-SEGMENT-FILTER` (real bug): deleting a video leaves `selectedVideoId` pointing at it — the filter select shows a phantom selection and the segment header claims "para este vídeo" for a deleted video. Reset `selectedVideoId` to null when the deleted video is the selected one | `frontend/src/app/admin/**`, `frontend/test/**` | RED: test selects a filter, deletes that video, asserts filter reset to "Todos los vídeos" → GREEN |
| T2 | 3.1 `R3-EDIT-DELETE-COVERAGE`: missing edit/delete flow tests — segment edit (PATCH path), segment delete (confirm + DELETE + reload), video delete success (confirm + DELETE + list reload) | `frontend/test/**` | New tests green against current behavior (coverage; no source change expected) |
| T3 | 3.2 `R3-SEGMENT-EDIT-PATCH-SEMANTICS`: pin the edit patch contract — symptomId set → sends `symptomId`, not `condition`; symptomId empty → sends `condition: ""` (clears); clip empty → `clipYoutubeId: null` explicit | `frontend/test/**` | New tests pin current behavior; fix only if a test reveals a real defect |
| T4 | 3.4 `R3-MissingBackendTests` + `R3-ReadPathReconstruction` (assessmentService getById): pin the reconstruction contract — persisted score/status stay historical, matchedWeight/maxWeight are recomputed from responses + current mappings | `backend/test/**` | New test: save assessment, GET /:id → matchedWeight reflects recomputation; verify coverage already present, extend if thin |
| T5 | Full verification: frontend suite + build, backend suite + tsc | none | all green |

## Progress

- [x] T1 — RED `1 failed | 5 passed` (phantom "para este vídeo" DOM observed) → GREEN 3-line guard in `handleDeleteVideo` after delete + reload
- [x] T2 — coverage green, no source change: segment edit (PATCH body), segment delete (DELETE + reload), video delete success (row pruned); 409 error path stays green. Note: first run's 2 failures were a testing-library label-hint lookup issue (prefix regexes), not a defect
- [x] T3 — PATCH contract pinned: symptomId set → `symptomId` key and NO `condition`; symptom empty → `condition: ""` explicit clear; clip empty → `clipYoutubeId: null`
- [x] T4 — reconstruction pinned: mapping inserted AFTER save → matchedWeight/maxWeight recomputed (3/5) while stored ratio/status stay historical (0.75/urgent); fixture restored
- [x] T5 — frontend **58/58** (52+6), backend **200/200** (199+1), both builds clean

## Evidence (commits per task)

- T1+T2+T3: `2d2e8df0` fix(admin): reset segment filter + edit/delete coverage + PATCH pins
- T4: `bd31df8b` test(assessment): pin getById read-path reconstruction
- Verification: worker RED/GREEN evidence per task; parent re-ran both
  suites + both builds inline (gentle-ai-verify unavailable this session)

## Decisions

- T1 is the only behavior change; T2–T4 are coverage/pinning. If pinning tests
  uncover a real defect, fix it inside the same task and say so in evidence.
- Stale-filter fix is deliberately minimal: clear selection on successful
  delete of the selected video (no broader state refactor).
