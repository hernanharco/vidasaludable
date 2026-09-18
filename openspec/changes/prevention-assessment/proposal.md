# Prevention Assessment — Proposal

## Problem Statement

The doctor's prevention practice relies on an Excel workbook ("Cálculo patologias_v6") to manually score patient symptoms and recommend nutrients/supplements. This is error-prone, not scalable, and impossible to track over time.

We need a web-based assessment system that:
1. Presents 95 symptoms in a guided wizard
2. Calculates nutrient deficiency scores using the exact Excel logic
3. Saves results for history tracking
4. Generates PDF reports and sends them via email

## Domain Model (ODD)

### Core Objects

```
Symptom
  ├── id: number (1-95)
  ├── name: string (Spanish)
  └── category: string

Nutrient
  ├── id: string
  ├── name: string
  ├── type: 'vitamin' | 'mineral' | 'fatty_acid' | 'supplement'
  └── description: string

SymptomNutrientMapping
  ├── symptomId: number
  ├── nutrientId: string
  └── weight: number (1 | 2)

Assessment
  ├── id: string (UUID)
  ├── patientName: string
  ├── patientSex: 'M' | 'F'
  ├── patientAge: number
  ├── createdAt: timestamp
  └── status: 'in_progress' | 'completed'

AssessmentResponse
  ├── assessmentId: string
  ├── symptomId: number
  └── answered: boolean (true = SI)

AssessmentResult
  ├── assessmentId: string
  ├── nutrientId: string
  ├── matchedWeight: number
  ├── maxWeight: number
  ├── ratio: number
  └── status: 'OK' | 'deficient' | 'urgent'
```

### Scoring Rules (from Excel)

```
For each nutrient:
  matchedWeight = Σ(mapping.weight for each symptom where response=true)
  maxWeight = Σ(mapping.weight for all mapped symptoms)
  ratio = matchedWeight / maxWeight

  ratio == 0        → "OK"
  0 < ratio < 0.3   → "deficient"
  ratio >= 0.3      → "urgent"
```

## API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/assessment/questionnaire` | Returns all 95 symptoms grouped for wizard steps |
| POST | `/assessment/calculate` | Accepts responses, returns scored results |
| POST | `/assessment` | Saves a completed assessment |
| GET | `/assessment/:id` | Retrieves a saved assessment with results |
| GET | `/assessment/history` | Lists past assessments (admin) |
| POST | `/assessment/:id/email` | Sends result via email |

## Frontend Design

### Widget Flow
1. **Trigger**: Floating button on landing page → opens modal
2. **Step 1**: Welcome + patient data (name, sex, age)
3. **Steps 2-N**: Symptoms grouped (~10 per step), checkbox SI/NO
4. **Final Step**: Results dashboard + PDF download + email option

### Results Dashboard
- Traffic-light display per nutrient category (vitamins, minerals, etc.)
- Each nutrient shows: name, status badge (OK/Deficient/Urgent), score bar
- Expandable detail showing which symptoms contributed
- Download PDF button
- Send to email input

## Non-Goals (v1)
- User authentication (admin already has basic auth)
- Multi-language (Spanish only for now)
- Complex email templating (plain text report is fine)
- Real-time chat integration (separate from ChatWidget)

## Success Criteria
1. Scoring results match the Excel exactly for test cases
2. All 95 symptoms load correctly in the wizard
3. Assessment saves to SQLite and can be retrieved
4. PDF generates with correct scores and recommendations
5. Email sends with PDF attachment
