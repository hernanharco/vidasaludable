# Archive Report — prevention-assessment

**Status**: ARCHIVED — implemented, verified, and closed
**Archived at**: 2026-10-04
**Archived to**: `openspec/changes/archive/2026-10-04-prevention-assessment/`

## Final State (authoritative — at close)

| Fact | Final value | Source |
|------|-------------|--------|
| Data foundation | 95 symptoms · 31 nutrients · weighted mappings seeded from the Excel ("Cálculo patologias_v6ESPAÑOL") | `backend/src/seed/assessment_seed_data.json`, `seedAssessment.ts`, `verifyAssessment.ts` |
| Schema | `assessment_symptoms`, `assessment_nutrients`, `assessment_symptom_nutrient_map`, `assessments`, `assessment_responses`, `assessment_results`; idempotent DDL in `migrate.ts` | `backend/src/db/schema.ts` + `migrate.ts` |
| Scoring engine | `calculateNutrientStatus` / `calculateAllNutrients` / recommendations; TDD RED→GREEN→REFACTOR; calibrated price fix (Double X → 86.87) | `backend/src/services/scoring.ts`, `backend/test/scoring.test.ts`, commit 17c2d1c6 |
| API | `GET /assessment/questionnaire`, `POST /assessment/calculate`, `POST /assessment`, `GET /assessment/:id`, `GET /assessment/:id/pdf`, `POST /assessment/:id/email` | `backend/src/routes/assessment.ts` |
| Admin | `GET /admin/assessment/results` (completed only, dev-only guard) + symptoms/nutrients/mappings management | `backend/src/routes/adminAssessment.ts` |
| Frontend | Floating widget → welcome/patient data → symptom wizard → results dashboard with PDF download + email send; wired in `App.tsx` | `frontend/src/app/components/assessment/` |
| Tests at close | backend **195/195** vitest (14 files), frontend **46/46** (6 files), `tsc` clean | local runs 2026-10-04 |
| Deployment | Live in production behind CI/CD (Vercel frontend + Hetzner Docker backend) | README + `compose.prod.yaml` |

## Documented deviation

- `GET /assessment/history` (Task 3.3) was **deliberately omitted**: a public
  history endpoint would expose patient names and symptom responses without
  authentication (LOPD/GDPR risk — same reasoning as the dev-only CRM guard in
  `openspec/specs/customer-crm/spec.md`). History tracking is served by the
  dev-only `GET /admin/assessment/results`.

## Change Summary

Web-based prevention assessment replacing the doctor's manual Excel scoring
workflow: a guided wizard over 95 symptoms, nutrient deficiency scoring that
mirrors the exact Excel logic, persisted results with history in the CRM, and
PDF report generation delivered by download or email.
