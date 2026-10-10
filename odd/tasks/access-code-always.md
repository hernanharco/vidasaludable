# Feature: access-code-always (código de acceso siempre + registro recordado)

## User decision (2026-10-09)

**El código de acceso se pide SIEMPRE** al abrir `/chat`, aunque el usuario
ya esté registrado. Con identidad guardada y consentimiento vigente, el
registro se auto-completa y **solo falta el código**.

## Problem

Reportado en producción: `https://vidasaludable.rincom.es/chat` no pide el
código de acceso del recomendador — entra directo al chat.

**No es una regresión del rediseño.** El popup viejo hacía exactamente lo
mismo: `if (customerId == null) → access_code`, y un usuario recurrente saltaba
directo al chat. Lo confirma el historial de producción: los 2 customers se
registraron el 2026-09-28 y 09-29 (cuando existía el popup).

El efecto real es que **el código de atribución solo se pide en el primer
registro**. Un usuario ya registrado nunca vuelve a atribuirse a un referente
nuevo, porque el `AccessCodeGate` se saltea.

## Design

### Attribution semantics: last-touch

`backend/src/services/customerService.ts` — `register()` es un upsert que, si
el customer ya existe, solo llama `reConsent(existing.id)` y **descarta**
`input.referrerId`. Pedir el código siempre no sirve de nada mientras eso sea
así.

**Last-touch** es lo coherente con "pedirlo siempre": si el código se pide en
cada visita, es porque importa el toque actual. (First-touch haría inútil
pedirlo siempre.)

### Backend — new `POST /assistant/attribution`

No se puede reusar `register()`: exige `name`/`email`/`phone`, que el frontend
no guarda (solo `vr_customer_id` en localStorage).

```
POST /assistant/attribution
{ "customer_id": 12, "referrer_id": 1 }
```

| Status | Body | Frontend reaction |
|--------|------|-------------------|
| 400 | `{error}` | `customer_id` inválido — tratar como identidad corrupta |
| 401 | `{error:"CONSENT_REQUIRED", consent:{...}}` | consentimiento desactualizado → `gate` (re-consent) |
| 404 | `{error}` | customer no existe → limpiar localStorage → `gate` completo |
| 200 | `{ok:true}` | consentimiento vigente → auto-registro hecho → profile check |

On 200 the service **updates `referrer_id`** (last-touch) and refreshes the
consent timestamp only if needed — it must NOT touch `name`, `email`, `phone`
or the registration date.

### Frontend — boot always lands on `access_code`

`ChatSession.tsx`, efecto de boot (línea ~252): eliminar el branch "returning
user → chat directo". **Siempre** `setPhase("access_code")`.

`handleAccessCodeValidated(referrerId)`:
- hay `customerId` → `POST /assistant/attribution`
  - 200 → profile check (`intake` vs `chat`, ya existente)
  - 401 → `gate`
  - 400/404 → limpiar `STORAGE.customerId` + `STORAGE.conversationId` → `gate`
- no hay `customerId` → `gate` (sin cambios)

`referrerId` validado debe **reemplazar** el estado previo, no acumularse.

### Out of scope

- The 95-symptom wizard's own `AccessCodeGate` (its scope is the assessment,
  not chat attribution).
- Consent version bump — `CURRENT_CONSENT_VERSION` stays 1.
- No new localStorage keys; reuse `vr_customer_id` / `vr_conversation_id`.

## Tasks

| # | Task | Edit surfaces | Verification |
|---|------|---------------|--------------|
| T1 | Backend: `attribution()` en `customerService` (last-touch, valida consent) + `POST /assistant/attribution` | `backend/src/services/customerService.ts`, `backend/src/routes/assistant.ts`, `backend/test/attribution.integration.test.ts` | RED: test 200/401/404/400 + `referrer_id` actually updated + name/email/phone untouched → GREEN; suite + tsc |
| T2 | Frontend: boot siempre a `access_code`; `handleAccessCodeValidated` con atribución y ramas 200/401/404 | `frontend/src/app/components/chat/ChatSession.tsx`, `frontend/test/AccessCodeAlways.test.tsx` | RED: test (returning customer con consent vigente ve el gate y NO el chat; 401 → gate; 404 → identidad limpia + gate) → GREEN; suite + tsc |
| T3 | E2E + docs | `odd/tasks/access-code-always.md` | suites verdes, build OK, smoke contra producción |

## Progress

- [ ] T1
- [ ] T2
- [ ] T3

## Evidence (commits per task)

## Decisions

- **Last-touch attribution**: el código más reciente sobreescribe. Coherente
  con "pedirlo siempre" — first-touch haría inútil pedirlo.
- **Endpoint dedicado en vez de reusar `register()`**: register exige
  name/email/phone que el frontend no persiste; un endpoint de atribución es
  más chico y no ensancha el contrato de registro.
- **El código se pide en cada visita**, no se persiste. Si se persistiera, se
  volvería al problema actual.
