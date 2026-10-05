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
| T6 | Act on the 2 advisory findings the resilience lens admitted: scope `push` to `main` + `concurrency`/`cancel-in-progress` (R4-duplicate-triggers); add a `Production build` step (R4-no-build-gate) | `.github/workflows/ci.yml`, `odd/tasks/ci-quality-gates.md` | js-yaml parses · frontend 71/71 · typecheck 0 · **`pnpm build` exit 0** (the new gate) |

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
- [x] T6 — Both advisory findings fixed in one unit. `ci.yml` now scopes
      `push` to `branches: [main]` (PRs covered by `pull_request`, so a
      same-repo PR no longer runs every job twice), adds
      `concurrency: ${{ github.workflow }}-${{ github.ref }}` with
      `cancel-in-progress: true`, and adds a `Production build` step
      (`pnpm build`, the exact command Vercel runs) to the frontend job.
      Verified independently: js-yaml parses (7 frontend steps / 6 backend),
      frontend 71/71, typecheck 0, `pnpm build` exit 0 (2703 modules, only
      the pre-existing 920 kB chunk warning).

## Evidence (commits per task)

- T1: `88214570` build(frontend): type-check and test the frontend for the first time
- T2: `689e3273` fix(frontend): clear the 26 errors surfaced by the first typecheck
- T3: script landed in `88214570` (same package.json edit as T1); run recorded above
- T4: `fc286257` ci: run tests and typecheck on every push and PR
- T5: `c5d0ca1b` docs(odd): record ci-quality-gates feature (T1-T5)
- T6: `67bf530a` ci: scope push to main, add concurrency and a production build gate
- T6 doc: this commit

## Native review

- Lineage `review-8f7bea06132e94ea` · target `sha256:878edd5c…` · base
  `b0427a1c` committed-only · 12 paths / 1258 changed lines · tier **high**
  (risk reasons: `process_boundary` in `frontend/package.json`, `shell_source`
  in `.github/workflows/ci.yml`) · correction budget 200.
- Lenses: risk → resilience → readability → reliability (4 model runs via
  `pi_host_relay`). Forecast relayed before authorization.
- The first group capture ended in `pi-host-relay-transport-failure`
  (`mutation_outcome: partial`, 3/4 admitted). Bound STATUS re-offered exactly
  the remaining `review-reliability` slot; capturing it closed the review.
- Result: state **approved** → `native-approved-acknowledgement-completed`,
  authority **burned**, `consumed_revision sha256:f136d747…`.
- Delivery stays under ordinary repository policy.

## Delivery (2026-10-05)

- Labels `status:approved` and `type:chore` created on the target repo (it
  had none beyond GitHub's defaults).
- Issue **#6** created from repository evidence, duplicate-searched first
  (the repo had never had an issue), read back and confirmed, then labelled
  `status:approved`.
- Branch pushed: `origin/feat/ci-quality-gates` = `22b5af5b` (7 commits).
- PR **#7** opened against `main` with `Closes #6` and exactly one
  `type:*` label (`type:chore`).
- CI on the PR ran **once** (the `push`-scoped-to-`main` fix working as
  intended) and went green: `Backend (test + typecheck)` pass 29s,
  `Frontend (test + typecheck + build)` pass 45s, run `success`.
- Merge is the user's decision.
- Third lineage `review-aecb15940df82f39` covered the T6 fix as an uncommitted
  `current-changes` candidate (1 path / 22 lines, correction budget 11):
  **approved**, authority burned (`consumed_revision sha256:73d39021…`),
  4/4 reviewers admitted with no refusals.

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
- **Both jobs always run** (initially planned as path-scoped): with 2 suites
  totalling < 1 min, a `paths-filter` dependency and its edge cases cost more
  than the compute it saves. Revisit if CI time ever hurts.
- **No ESLint in this unit**: the project has never had one; introducing a
  linter would surface hundreds of stylistic findings and swamp review. Own
  unit if wanted.
- **Frontend `build` IS in CI since T6** — the T4 decision below recorded it
  as deliberately out (deploy builds it); the resilience lens flagged that as
  a candidate-introduced gap (`R4-no-build-gate`), so a `Production build`
  step now runs the same `pnpm build` Vercel executes. The redundancy with
  the deploy build is the point: a bundle regression must fail the gate, not
  the deploy.
- **`vitest.config.ts` `configFile: false`** kept with a cast: the worker read
  it may be a no-op (Vite loads exactly one config file, `vitest.config.ts`
  wins over `vite.config.ts`) but could not prove it, and deleting runtime
  behavior inside a typecheck unit would be scope creep. Candidate follow-up.
