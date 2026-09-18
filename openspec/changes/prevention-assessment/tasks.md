# Prevention Assessment — Tasks

## Phase 1: Data Foundation (ODD)
Extract and seed the Excel data into SQLite.

### Task 1.1: Parse Excel → seed data
- Extract all 95 symptoms with Spanish names
- Extract all 31 nutrients with categories
- Extract symptom→nutrient mappings with weights
- Create seed script: `backend/src/seed/seedAssessment.ts`
- Output: JSON seed files or direct SQLite insert

### Task 1.2: Database schema
- Add assessment tables to Drizzle schema
- Tables: `assessment_symptoms`, `assessment_nutrients`, `assessment_symptom_nutrient_map`, `assessments`, `assessment_responses`, `assessment_results`
- Migration: `backend/src/db/migrations/`

## Phase 2: Scoring Engine (TDD)
Core logic with tests that validate against the Excel.

### Task 2.1: Scoring engine — RED
- Write failing tests for `calculateNutrientStatus()`
- Test cases from Excel: pick 5 symptoms, verify expected nutrient scores
- Test edge cases: no symptoms, all symptoms, single symptom

### Task 2.2: Scoring engine — GREEN
- Implement `backend/src/services/scoring.ts`
- `calculateNutrientStatus(responses, mapping)` → {score, maxWeight, ratio, status}
- `calculateAllNutrients(responses)` → AssessmentResult[]
- `getRecommendations(results)` → nutrient suggestions

### Task 2.3: Scoring engine — REFACTOR
- Clean up, extract helpers if needed
- Ensure all tests pass

## Phase 3: API Endpoints (TDD)

### Task 3.1: Questionnaire endpoint — RED→GREEN
- `GET /assessment/questionnaire` returns symptoms grouped for wizard
- Group size: ~10 symptoms per step
- Include nutrient context for each group

### Task 3.2: Calculate endpoint — RED→GREEN
- `POST /assessment/calculate` accepts {responses: [{symptomId, answered}]}
- Returns scored results for all 31 nutrients
- Does NOT save (pure calculation)

### Task 3.3: Save + Retrieve — RED→GREEN
- `POST /assessment` saves patient data + responses + results
- `GET /assessment/:id` retrieves full assessment
- `GET /assessment/history` lists past assessments

### Task 3.4: Email endpoint
- `POST /assessment/:id/email` sends PDF via email
- Use existing email config if available, or nodemailer

## Phase 4: Frontend Widget

### Task 4.1: Widget shell + modal
- Floating button component
- Modal with step navigation
- Progress indicator

### Task 4.2: Patient data form (Step 1)
- Name, sex, age fields
- Validation with react-hook-form

### Task 4.3: Symptom wizard (Steps 2-N)
- Dynamic steps from API
- Checkbox grid per symptom
- Back/Next navigation
- State management across steps

### Task 4.4: Results dashboard (Final step)
- Nutrient cards grouped by category
- Status badges with colors (green/yellow/red)
- Score bars
- Expandable symptom details

### Task 4.5: PDF generation
- Backend endpoint: `POST /assessment/:id/pdf`
- Generate PDF with results + recommendations
- Frontend: download button

### Task 4.6: Email delivery
- Backend endpoint: `POST /assessment/:id/email`
- Send PDF as attachment
- Frontend: email input + send button

## Phase 4: Integration

### Task 4.1: Wire widget into landing page
- Add floating button to Landing component
- Modal state management

### Task 4.2: End-to-end testing
- Full flow: open widget → fill data → answer symptoms → see results → download PDF

## Dependencies
- Tasks 1.1-1.2 (data) → Task 2.x (scoring) → Task 3.x (API) → Task 4.x (frontend)
- Phase 2 is the critical path — scoring must match Excel exactly
