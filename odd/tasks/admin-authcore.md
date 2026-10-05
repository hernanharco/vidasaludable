# Feature: admin-authcore

Replace the ad-hoc basic auth on the vidasaludable `/admin` CRM with the
ecosystem auth hub **authCore** (Google OAuth → JWT RS256), following the
validated spoke pattern (`core/auth/AUTH-FLOW.md` + CafeMiTierra reference),
with two improvements over the reference: JWT `exp` IS validated, and access
is restricted to roles ADMIN/SUPERADMIN.

## User decisions (2026-10-04)

- Access: **role ADMIN or SUPERADMIN** in the JWT, else 403.
- Basic auth: **removed entirely** (frontend sessionStorage flow,
  `ADMIN_USER`/`ADMIN_PASS` in server `.env`, backend basicAuth middleware).
- Hub: register tenant **`vidasaludable`** in authCore (seed + prod DB).

## Architecture

```
React SPA (vidasaludable.rincom.es)
  /admin/login   → "Continuar con Google" → api-authcore.rincom.es
                   /api/v1/auth/google?redirect_to={origin}/auth/callback
  /auth/callback → receives ?token=JWT → sets cookie token (7d, Lax) → /admin
  guard          → no cookie → show Login; api.request adds Authorization: Bearer
Backend (Hono, Hetzner)
  /admin/* (non-dev) → verify JWT: JWKS fetch+cache, RS256 signature, exp,
                       role in {ADMIN,SUPERADMIN} → 401 (missing/invalid/expired)
                       | 403 (role) | c.set("user")
  dev (NODE_ENV=development) → open, as today
authCore (hub, api-authcore.rincom.es:8000, JWKS verified live)
  + new tenant 'vidasaludable' (website_url/admin_url)
```

Key facts discovered in exploration:
- **SECURITY GAP (pre-existing): `routes/adminReferrer.ts` has NO guard at all**
  — `/admin/referrers*` (list/create/delete referrers + related customers) is
  fully public in production today. `admin.ts` and `adminAssessment.ts` have
  their own basicAuth copies. T1 replaces all three with ONE central guard.
- JWKS `https://api-authcore.rincom.es/.well-known/jwks.json` responds ✅
- authCore has NO allowlist for `redirect_to` (open redirect — hub issue,
  documented, out of scope here)
- CafeMiTierra's verify does NOT check `exp` — we WILL (noted divergence)
- Vercel rewrite `/api/*` → backend is same-origin for the browser, so the
  `token` cookie rides along on admin requests; backend reads Bearer OR cookie
- authCore repo: `~/Documentos/elrincondeharco.com/authCore` (branch `dev`),
  prod DB via compose on Hetzner; seed idempotent by slug

## Tasks

| # | Task | Edit surfaces | Verification |
|---|------|---------------|--------------|
| T1 | Backend JWT auth: new `services/auth.ts` (JWKS fetch+cache, RS256 verify via WebCrypto, exp check, role extraction) + **ONE central guard `app.use("/admin/*")` in `index.ts`** replacing the two basicAuth copies (admin.ts, adminAssessment.ts) AND closing the unguarded adminReferrer.ts (dev open / prod Bearer-or-cookie, role ADMIN\|SUPERADMIN) | `backend/src/services/**`, `backend/src/index.ts`, `backend/src/routes/admin.ts`, `backend/src/routes/adminAssessment.ts`, `backend/test/**` | RED→GREEN: signed-JWT tests (valid 200, no token 401, bad sig 401, expired 401, role USER 403, dev open, **referrers routes protected too**) |
| T2 | Frontend login flow: Login screen with Google button, `/auth/callback` route (token→cookie→redirect), CRM guard (no cookie → Login), `api.request` sends `Authorization: Bearer`, remove basic-auth sessionStorage flow | `frontend/src/app/**`, `frontend/test/**` | RED→GREEN: login render, callback sets cookie + redirects, guard blocks, Bearer attached; suite + build |
| T3 | Hub: add tenant `vidasaludable` to `seed_tenants.py` (website_url, admin_url) + run seed against prod DB | `../authCore/backend/scripts/seed_tenants.py` (separate repo!) | Seed idempotent; tenant visible in authCore DB/dashboard |
| T4 | Cleanup: remove `ADMIN_USER`/`ADMIN_PASS` from server `.env`, update README + CRM footer label ("Panel dev-only · sin autenticación" → accurate) | server `.env`, `README.md`, frontend footer | grep no ADMIN_ refs; footer updated |
| T5 | Full verification + deploy: backend/frontend suites, builds, push (webhook + Vercel), live smoke: CRM redirects to login, Google flow completes, admin API accepts JWT | — | all green + live E2E evidence |

## Progress

- [x] T1 — backend JWT + guard central (RED stages A/B observed → GREEN 16/16;
  suite final 216/216, tsc 0)
- [x] T2 — frontend login flow (worker 12 tests GREEN; parent gate-fix
  test-first: RED 2 failed → GREEN 13/13; suite final 71/71, build 0)
- [x] T3 — tenant `vidasaludable` seed applied to prod (psql verified row) +
  repo seed committed/pushed (authCore 919951f)
- [x] T4 — ADMIN_* removed from server .env (backup .env.bak-20261005-002042),
  zero basic-auth refs in src, footer → "Panel protegido · authCore (Google)",
  README section added
- [x] T5 — deploys + live smoke green (evidence below)

## Evidence (commits per task)

- T1: `35c5ae03` feat(admin): verify authCore JWT behind one central /admin guard
- T2: `12776301` feat(admin): Google login flow via authCore (incl. gate dev-open fix)
- T3: authCore repo `919951f` (pushed origin/dev) + prod seed run:
  `✅ Tenant creado: vidasaludable`, row verified in `authharco.tenants`
  (website_url + admin_url, is_active=t)
- T4: `115a1a68` docs(admin auth) + server .env cleanup (0 ADMIN_ refs)
- T5 verification:
  - Suites: backend **216/216** (baseline 200 + 16), frontend **71/71**
    (baseline 58 + 13); `tsc` 0; `vite build` 0.
  - authCore handoff: `GET /api/v1/auth/google?redirect_to=vidasaludable…/auth/callback`
    → **307 → accounts.google.com** (redirect_uri = hub callback, spoke url in
    state); JWKS live (`kid authcore-key-1`).
  - Push main `115a1a68` → GH `Deploy Frontend` success; webhook rebuilt
    server (git = 115a1a68, container recreated, healthy).
  - Prod smoke: `GET /api/admin/catalog` sin token → **401 {"error":"token_requerido"}**
    JSON, **no WWW-Authenticate** (browser dialog gone); **`/api/admin/referrers`
    also 401 — the pre-existing unguarded gap is closed in prod**; `/api/health`
    OK; new bundle contains "Continuar con Google" + "auth/callback" and ZERO
    `vr_admin_auth` strings.
  - NOT automated: the actual Google click-through (needs human Google
    session) — manual E2E left to the owner as the final confirmation.
  - Review `review-06eedfb06268db54` (tier high, `hot_path auth` → 4 lenses):
    **correction_required** on CRITICAL `R4-jwks-cache-no-invalidation`
    (JWKS cached forever: no TTL/kid/invalidation → hub key rotation =
    total admin lockout). Correction plan 160 lines → implemented in
    **142/160** (commit `c9c6b309`: 10-min TTL, kid-based key selection,
    stale-mark-not-wipe on signature failure + one refetch retry, stale
    serve only on kid match) with a rotation test (RED → GREEN).
    Targeted validator re-ran → **APPROVED**, authority burned.
    Advisory (12, informational): 4×R1 (token in URL query, http cookie on
    https, cookie parse, index cookie split), 4×R2 (magic number, cookie
    parsing divergence, cross-layer error strings, hardcoded probe URL),
    2×R3 (JWKS cache no background refresh, restricted dead-end state),
    2×R4 (cookie token truncation, JWKS fetch no timeout) — inventoried
    here as follow-ups, none blocking.

## Decisions

- Fail-closed: if JWKS is unreachable in prod, admin requests are rejected
  (401) — same as CafeMiTierra; no silent bypass.
- Dev keeps the current open behavior (no dev-token ceremony) — matches
  vidasaludable's existing dev-only philosophy and keeps tests simple.
- Cookie: `token`, path=/, 7 days, SameSite=Lax, `secure` in prod. Non-httpOnly
  is required for the SPA to attach `Authorization: Bearer` (same tradeoff the
  ecosystem pattern documents).
- Tenant registration does NOT gate access (JWT audience is not validated by
  the spoke pattern); it exists for hub-model consistency and quick links.
- ONE central guard in `index.ts` (`app.use("/admin/*")`) instead of
  per-router guards: single source of truth, closes the adminReferrer gap,
  and keeps dev behavior (open) in exactly one place. The internal basicAuth
  blocks in admin.ts / adminAssessment.ts are removed in the same task.
- No push to main until T1+T2 land together (an intermediate push would
  break the live CRM: old frontend sends Basic, new backend expects JWT).
