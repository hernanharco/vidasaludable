# Feature: ci-quality-gates

Branch: `feat/ci-quality-gates`

Source: project survey (2026-10 session). Top-2 findings by impact:

1. **CI is deploy-only** — `.github/workflows/frontend-deploy.yml` and
   `backend-deploy.yml` run no test, typecheck, or lint step. The 288 green
   tests (backend 217, frontend 71) never run on push/PR; a regression reaches
   production undetected.
2. **Frontend has no type checking** — there is no `tsconfig.json` anywhere in
   `frontend/` and no `typescript` devDependency, so 107 `.ts/.tsx` files are
   transpiled by Vite/esbuild without ever being checked. Bonus hazard:
   `npx tsc` resolves a decoy npm package instead of TypeScript.

Non-goals: adding ESLint, refactoring code, changing runtime behavior, backend
tsconfig changes (backend already type-checks clean).

## Tasks

| # | Task | Edit surfaces | Verification |
|---|------|---------------|--------------|
| T1 | Add `typescript` devDependency + `frontend/tsconfig.json` (strict-ish, jsx react-jsx, bundler resolution, path alias `@/*`) and a `typecheck` script | `frontend/package.json`, `frontend/tsconfig.json`, `frontend/pnpm-lock.yaml` | `pnpm typecheck` runs (exit >0 initially is expected if errors surface) |
| T2 | Drive `pnpm typecheck` to exit 0: fix real type errors; use the narrowest honest config (`skipLibCheck`, targeted `@ts-expect-error` only with a reason) — no blanket `any` | `frontend/src/**`, `frontend/tsconfig.json` | RED: typecheck fails with N errors → GREEN: 0 errors |
| T3 | Add frontend `test` script (`vitest run`) so the 7 suites are reachable via `pnpm test` | `frontend/package.json` | `pnpm test` → 71/71 |
| T4 | Add `.github/workflows/ci.yml`: on push/PR, backend `pnpm test` + `pnpm build`, frontend `pnpm test` + `pnpm typecheck`, as a job gate (not deploy) | `.github/workflows/ci.yml` | YAML valid (`actionlint` or `gh workflow view`), steps mirror verified local commands |
| T5 | Full verification + work-unit commit(s) | — | backend 217/217 + frontend 71/71 + frontend typecheck 0 errors + backend tsc clean |

## Progress

- [x] T1 — `typescript@5.7.3` devDep, `frontend/tsconfig.json` (strict +
      `noUncheckedIndexedAccess`, `jsx: react-jsx`, `moduleResolution:
      bundler`, `paths @/*`, `types: ["vite/client","node","vitest/globals"]`,
      `noEmit`), scripts `typecheck` and `test`. Also pinned
      `@types/react@18.3.12` + `@types/react-dom@18.3.1` + `@types/node@22.10.5`.
      RED observed: `tsc --noEmit` → **45 errors**.
- [x] T2 — GREEN 0 errors. Discovery: the repo shipped `@types/react@19.2.14`
      (transitive) against `react@18.3.1` runtime and had no
      `@types/react-dom`, which produced the `RefObject<…|null>` and
      `react-dom/client` noise; pinning types to the runtime removed 19 of the
      45 at the config level. The residual 26 were fixed by a worker:
      `.tsx` import extension dropped in `main.tsx`, unused `@ts-expect-error`
      removed in `test/setup.ts`, `resolveId(id: string)` typed, non-null `!`
      on **constant fixture indexes** in 3 test files (assertions unchanged),
      one targeted `as ViteUserConfig` cast in `vitest.config.ts` for the
      non-typable `configFile` option. **No `any`, no `@ts-ignore`, no config
      weakening.**
- [x] T3 — `pnpm test` → **71/71** green (script added in T1).
- [x] T4 — `.github/workflows/ci.yml`: `on: push / pull_request /
      workflow_dispatch`, two independent jobs (`backend`: install → `pnpm
      test` → `pnpm build`; `frontend`: install → `pnpm test` → `pnpm
      typecheck`), node 22 + pnpm 10 with per-package lockfile cache. Parsed
      and structure-checked with `js-yaml`.
- [x] T5 — Full verification by an independent verifier: backend **217/217**
      + `pnpm build` exit 0; frontend **71/71** + `pnpm typecheck` **0 errors**;
      working tree clean after the four commits below.

## Evidence (commits per task)

- T1: `88214570` build(frontend): type-check and test the frontend for the first time
- T2: `689e3273` fix(frontend): clear the 26 errors surfaced by the first typecheck
- T3: script landed in `88214570` (same package.json edit as T1); run recorded above
- T4: `fc286257` ci: run tests and typecheck on every push and PR
- T5: `8a53e0a9` docs(odd): record ci-quality-gates feature

## Incident (recorded, resolved)

The daily GitAutomatico cron (`0 23 * * *` → `~/.local/bin/autosync.sh`) fired
mid-task and wrapped all T1–T4 changes into `fd4f6e90 "auto-sync: 2026-10-05
23:00"` on this feature branch. Its push to `origin/dev` **failed** (no
credentials) so nothing left the machine — confirmed via
`~/.autosync/logs/2026-10-05.jsonl` and an empty `git ls-remote origin dev`.
With user authorization the commit was `reset --soft` and rebuilt as the four
work units above (content byte-identical, only grouping and messages changed).

## Decisions

- **Typecheck is a gate, not a deploy step**: `ci.yml` runs on push/PR for all
  branches; the existing deploy workflows keep their deploy-only semantics.
- **Path-scoped jobs**: backend job only required when `backend/**` changes,
  frontend when `frontend/**` or the workflow itself changes — mirrors how the
  deploy workflows already scope with `paths:`.
- **No ESLint in this unit**: the project has never had one; introducing a
  linter would surface hundreds of stylistic findings and swamp review. Own
  unit if wanted.
- **Both jobs always run** (initially planned as path-scoped): with 2 suites
  totalling < 1 min, a `paths-filter` dependency and its edge cases cost more
  than the compute it saves. Revisit if CI time ever hurts.
- **Frontend `build` is not in CI** — `frontend/package.json` `build` re-runs
  `pnpm install --frozen-lockfile` and the Vercel deploy already builds. CI
  owns test + typecheck; deploy owns the bundle.
- **`vitest.config.ts` `configFile: false`** kept with a cast: the worker read
  it may be a no-op (Vite loads exactly one config file, `vitest.config.ts`
  wins over `vite.config.ts`) but could not prove it, and deleting runtime
  behavior inside a typecheck unit would be scope creep. Candidate follow-up.
