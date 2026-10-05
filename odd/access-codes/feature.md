# Feature: Access Codes (Referrer Tracking)

## Problem
Need to track who refers each person to the site. Before using the chat or assessment, users must enter an access code that identifies their referrer.

## Requirements
1. **Access code gate** — Before chat or assessment, user must enter a valid code
2. **CRM management** — Referrers and their codes are created/managed from the CRM
3. **Invalid code = blocked** — No access without a valid code
4. **Tracking** — Each customer/assessment is linked to their referrer

## Data Model

### New table: `referrers`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| code | TEXT UNIQUE | The access code (e.g., "1906432239") |
| name | TEXT | Referrer's full name |
| phone | TEXT | Optional |
| email | TEXT | Optional |
| active | INTEGER | 0/1, soft-disable without deleting |
| created_at | TEXT | Timestamp |

### Modified: `customers`
- Add `referrer_id` INTEGER (FK → referrers.id, nullable)

### Modified: `assessments`
- Add `referrer_id` INTEGER (FK → referrers.id, nullable)

## API Endpoints

### Public
- `POST /referrer/validate` — `{ code: string }` → `{ valid: true, referrerName: string }` or 404

### CRM (admin)
- `GET /admin/referrers` — List all referrers with stats (customer count)
- `POST /admin/referrers` — Create new referrer `{ code, name, phone?, email? }`
- `PUT /admin/referrers/:id` — Update referrer
- `DELETE /admin/referrers/:id` — Soft-delete (set active=0)

## Frontend Flow

### Chat (ChatWidget)
1. User opens chat → **AccessCodeGate** (enter code)
2. Code validated → show referrer name, user confirms
3. RegistrationGate → register with name, email, phone
4. Chat begins

### Assessment (AssessmentWidget)
1. User opens assessment → **AccessCodeGate** (enter code)
2. Code validated → show referrer name, user confirms
3. AssessmentWelcome → enter name, sex, age
4. Symptoms → Results

### CRM
- New page: ReferrersPage — CRUD for referrers + stats
- CustomersPage shows referrer name
- AssessmentResults shows referrer name

## Non-Goals
- Public registration (codes are invite-only, created in CRM)
- QR codes or sharing mechanics (just text codes)
