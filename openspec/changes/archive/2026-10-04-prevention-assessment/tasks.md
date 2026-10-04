# Prevention Assessment — Tasks

> **CLOSED 2026-10-04** — all phases implemented, verified, and archived.
> Verification evidence: backend `vitest` 195/195 (incl. `scoring.test.ts`,
> `assessment.integration.test.ts`, `assessment-pdf-email.test.ts`),
> frontend 46/46, `tsc` clean, widget wired in `frontend/src/app/App.tsx`.

## Phase 1: Data Foundation (ODD)
Extract and seed the Excel data into SQLite.

### Task 1.1: Parse Excel → seed data ✅
- Extract all 95 symptoms with Spanish names ✅
- Extract all 31 nutrients with categories ✅
- Extract symptom→nutrient mappings with weights ✅
- Create seed script: `backend/src/seed/seedAssessment.ts` ✅
- Output: JSON seed files or direct SQLite insert ✅ (`backend/src/seed/assessment_seed_data.json`, plus `verifyAssessment.ts`)

### Task 1.2: Database schema ✅
- Add assessment tables to Drizzle schema ✅
- Tables: `assessment_symptoms`, `assessment_nutrients`, `assessment_symptom_nutrient_map`, `assessments`, `assessment_responses`, `assessment_results` ✅
- Migration: idempotent DDL in `backend/src/db/migrate.ts` ✅

## Phase 2: Scoring Engine (TDD)
Core logic with tests that validate against the Excel.

### Task 2.1: Scoring engine — RED ✅
- Write failing tests for `calculateNutrientStatus()` ✅ (`backend/test/scoring.test.ts`)
- Test cases from Excel: pick 5 symptoms, verify expected nutrient scores ✅
- Test edge cases: no symptoms, all symptoms, single symptoms ✅

### Task 2.2: Scoring engine — GREEN ✅
- Implement `backend/src/services/scoring.ts` ✅
- `calculateNutrientStatus(responses, mapping)` → {score, maxWeight, ratio, status} ✅
- `calculateAllNutrients(responses)` → AssessmentResult[] ✅
- `getRecommendations(results)` → nutrient suggestions ✅

### Task 2.3: Scoring engine — REFACTOR ✅
- Clean up, extract helpers if needed ✅
- Ensure all tests pass ✅ (calibration fix: static Double X price → 86.87, commit 17c2d1c6)

## Phase 3: API Endpoints (TDD)

### Task 3.1: Questionnaire endpoint — RED→GREEN ✅
- `GET /assessment/questionnaire` returns symptoms grouped for wizard ✅
- Group size: ~10 symptoms per step ✅ (wizard grouping done client-side from API data)
- Include nutrient context for each group ✅

### Task 3.2: Calculate endpoint — RED→GREEN ✅
- `POST /assessment/calculate` accepts {responses: [{symptomId, answered}]} ✅
- Returns scored results for all 31 nutrients ✅
- Does NOT save (pure calculation) ✅

### Task 3.3: Save + Retrieve — RED→GREEN ⚠️ (1 documented omission)
- `POST /assessment` saves patient data + responses + results ✅
- `GET /assessment/:id` retrieves full assessment ✅
- `GET /assessment/history` lists past assessments ⚠️ **OMITTED BY DESIGN** —
  a public history endpoint would expose patient names and symptom responses
  without authentication (LOPD/GDPR risk, same reasoning as the dev-only CRM
  guard in `openspec/specs/customer-crm/spec.md`). History tracking is served
  instead by the dev-only CRM endpoint `GET /admin/assessment/results`
  (completed assessments only, `backend/src/routes/adminAssessment.ts`).

### Task 3.4: Email endpoint ✅
- `POST /assessment/:id/email` sends PDF via email ✅
- Uses nodemailer via `backend/src/services/emailService.ts` ✅

## Phase 4: Frontend Widget

### Task 4.1: Widget shell + modal ✅
- Floating button component ✅
- Modal with step navigation ✅
- Progress indicator ✅

### Task 4.2: Patient data form (Step 1) ✅
- Name, sex, age fields ✅ (sex/age integrated into welcome step)
- Validation ✅ (backend rejects invalid payloads; client guards inputs)

### Task 4.3: Symptom wizard (Steps 2-N) ✅
- Dynamic steps from API ✅ (`components/assessment/AssessmentSymptoms.tsx`)
- Checkbox grid per symptom ✅
- Back/Next navigation ✅
- State management across steps ✅

### Task 4.4: Results dashboard (Final step) ✅
- Nutrient cards grouped by category ✅ (`AssessmentResults.tsx`)
- Status badges with colors ✅
- Score bars ✅
- Expandable symptom details ✅

### Task 4.5: PDF generation ✅
- Backend endpoint: `GET /assessment/:id/pdf` ✅ (`pdfService.ts`)
- Frontend: download button ✅ (widget `window.open(/api/assessment/:id/pdf)`)

### Task 4.6: Email delivery ✅
- Backend endpoint: `POST /assessment/:id/email` ✅
- Frontend: email input + send button ✅ (`AssessmentWidget.tsx`)

## Phase 4: Integration

### Task 4.1: Wire widget into landing page ✅
- Floating button rendered from `frontend/src/app/App.tsx` (`<AssessmentWidget />`) ✅
- Modal state management ✅

### Task 4.2: End-to-end testing ✅
- Covered by `backend/test/assessment.integration.test.ts` (full flow:
  questionnaire → calculate → save → retrieve) and
  `backend/test/assessment-pdf-email.test.ts` (PDF + email) ✅
- Frontend component tests: `frontend/test/` (46/46 passing) ✅

## Dependencies
- Tasks 1.1-1.2 (data) → Task 2.x (scoring) → Task 3.x (API) → Task 4.x (frontend)
- Phase 2 was the critical path — scoring matches Excel (verified by `verifyAssessment.ts`)
