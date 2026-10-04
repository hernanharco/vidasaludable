# Feature: deploy-pipeline-cleanup

Fixes the two red deploy paths observed after the `fae688c5` push (user
approved "Arreglar ambos"). Branch work done directly on `main` (docs/CI-only
change, same session pattern as previous docs commits).

## Problems

1. **Vercel Git-integration build race** — Vercel's GitHub integration cloned
   the repo ROOT (no `package.json` → npm detected instead of pnpm → no
   install → `vite: command not found`, exit 127) on every push, racing the
   GH Actions prebuilt deploy that actually serves `vidasaludable.rincom.es`.
2. **Dead backend SSH job** — `Deploy Backend`'s deploy job dialed
   `HETZNER_HOST` (Tailscale IP `100.111.99.61`) from a GitHub-hosted runner →
   `dial tcp :22: i/o timeout` on every run since 2026-09-25. Real deploys run
   through `deploy-webhook.service` on the server (verified: git `fae688c5`,
   container healthy, `/api/health` OK).

## Tasks

| # | Task | Verification |
|---|------|--------------|
| T1 | Vercel API: set `commandForIgnoringBuildStep` = `if [ -n "$GITHUB_ACTIONS" ]; then exit 1; fi; exit 0` on project `prj_OpeTmO5Bs2V5DGfdH4NiThlzdTdD` — Vercel-Git builds exit 0 (skip), `vercel build` inside GH Actions exits 1 (proceed) | PATCH response echoes the command; live push shows no new Vercel error deployment |
| T2 | Remove dead `deploy` SSH job from `.github/workflows/backend-deploy.yml`; rename workflow `Deploy Backend` → `Build Backend`; document the webhook as the real deploy path | workflow runs green on next backend-touching push (or workflow_dispatch) |
| T3 | README: correct `VERCEL_PROJECT_ID` (old `prj_4vAW…` belongs to legacy `doctoraandrea`; real = `prj_OpeTmO5…`), mark HETZNER_* secrets legacy, document the two real deploy paths | doc review |
| T4 | Push + live verification | `gh run list` all green, no new Vercel Error deployment, prod bundle/API unchanged-healthy |

## Progress

- [x] T1 — PATCH applied, command confirmed in project settings
- [x] T2 — job removed, workflow renamed, header comment explains why
- [x] T3 — README updated (secrets table + cómo se deploya)
- [x] T4 — push + live verification (see Evidence)

## Evidence

- T1: PATCH `commandForIgnoringBuildStep` applied to `prj_OpeTmO5Bs2V5DGfdH4NiThlzdTdD`
  (team `team_0iXBDap6vHdalM0fEFusXlzy`); response echoed the exact command.
- T2+T3+doc: commit `05db8ad5` (branch fix/deploy-pipeline-cleanup → main ff).
- T4 live verification (push fae688c5 → 05db8ad5):
  - `gh run list`: `Deploy Frontend` 37209968426 **success** (52s); no new
    `Build Backend` run (this push touched no `backend/**` path — by design).
  - `vercel ls`: new Vercel-Git deployment `fm3gr3hgy` = **Canceled in 925ms**
    (ignore-step skip — no more `vite: command not found` Error);
    prebuilt deployment `mccb97ovk` = **Ready Production**.
  - Historical `Error` rows in `vercel ls` (39m/14h/5d old) are the pre-fix
    race artifacts; no new ones after the PATCH.
  - Prod: home **200**, `/api/health` `{"ok":true,"env":"production"}`,
    bundle `index-De29tEXk.js`.
- Follow-up (advisory closure): HETZNER_HOST/USER/SSH_KEY **deleted from
  GitHub** (gh secret list → only VERCEL_* remain); `Build Backend` exercised
  once via workflow_dispatch (run 37221056811, **success**) closing
  R4-UNVERIFIED-WORKFLOW; README secrets table updated to 🗑️ Eliminados.
- Remaining advisory: R4-SINGLE-DEPLOY-PATH (backend depends solely on the
  webhook — no fallback) — accepted as informational, documented here.

## Decisions

- Ignore-step discriminator: `$GITHUB_ACTIONS` is set only in GitHub Actions
  runners — Vercel's remote build environment never sets it, so Vercel-Git
  builds always skip while `vercel build` in our workflow always proceeds.
  Exit 0 = skip, non-zero = build (Vercel semantics).
- Kept `build-and-push` (GHCR image) as the CI signal that `Dockerfile.prod`
  still builds; the deploy itself stays with the server-side webhook.
- Alternative considered: disconnect the Vercel GitHub app entirely — rejected,
  it would break `vercel link`/CLI deploys and preview URLs.
