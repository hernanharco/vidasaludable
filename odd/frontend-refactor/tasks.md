# Feature: Frontend Refactor — Split oversized components

## Goal
Split 3 custom frontend components that exceed 400 lines into smaller, focused sub-components.

## Context
Review found 3 custom components over 400 lines:
- `AssessmentWidget.tsx` — 752 lines (wizard: loading → welcome → symptoms → calculating → results)
- `ChatWidget.tsx` — 522 lines (chat: boot → registration gate → chat)
- `Dashboard.tsx` — 526 lines (CRM dashboard: KPIs, charts, funnel, activity)

Note: `sidebar.tsx` (726 lines) is a shadcn/ui component — not touched.

## Tasks

### 1. Split AssessmentWidget.tsx (752 → ~250 + sub-components)
- [ ] Create `components/assessment/` directory
- [ ] Extract `AssessmentButton.tsx` — floating button + AnimatePresence wrapper
- [ ] Extract `AssessmentHeader.tsx` — modal header + close button
- [ ] Extract `AssessmentWelcome.tsx` — patient form (name, sex, age)
- [ ] Extract `AssessmentSymptoms.tsx` — symptom checkboxes with pagination
- [ ] Extract `AssessmentCalculating.tsx` — loading spinner state
- [ ] Extract `AssessmentResults.tsx` — results summary, recommendations, products, nutrients
- [ ] Refactor `AssessmentWidget.tsx` — thin orchestrator composing sub-components

### 2. Split ChatWidget.tsx (522 → ~200 + sub-components)
- [ ] Create `components/chat/` directory
- [ ] Extract `ChatButton.tsx` — floating button
- [ ] Extract `ChatHeader.tsx` — header bar with title + close
- [ ] Extract `RegistrationGate.tsx` — consent form + registration fields
- [ ] Extract `ChatMessages.tsx` — message list + typing indicator
- [ ] Extract `ChatInput.tsx` — text input + send button
- [ ] Refactor `ChatWidget.tsx` — thin orchestrator composing sub-components

### 3. Split Dashboard.tsx (526 → ~150 + sub-components)
- [ ] Create `admin/dashboard/` directory
- [ ] Extract `KpiCards.tsx` — 5 KPI link cards
- [ ] Extract `TrendCharts.tsx` — two AreaCharts (registros + recomendaciones)
- [ ] Extract `ConversionFunnel.tsx` — funnel bar visualization
- [ ] Extract `TopSymptoms.tsx` — top 5 symptoms list
- [ ] Extract `PurchasesChart.tsx` — BarChart of purchases by product
- [ ] Extract `RecentCustomers.tsx` — recent customers table
- [ ] Extract `RecentActivity.tsx` — recent recommendations list
- [ ] Refactor `Dashboard.tsx` — thin orchestrator composing sub-components

### 4. Verify build passes
- [ ] Run `pnpm build` in frontend
- [ ] Confirm no regressions
