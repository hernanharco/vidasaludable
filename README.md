# vidasaludable

Landing page y sistema de recomendación de vitaminas Nutrilite.

## Estructura

├── frontend/   # Aplicación web (React + Vite + Tailwind)
├── backend/    # API (Hono + SQLite)
└── .github/    # CI/CD workflows

## Desarrollo

cd frontend && pnpm install && pnpm dev
cd backend && pnpm install && pnpm dev

## Deploy

- **Frontend**: Vercel vía GH Actions (`Deploy Frontend`: `vercel build` +
  `--prebuilt`). Los builds de la integración Git de Vercel están **deshabilitados**
  (Ignored Build Step en el proyecto): solo corre `GH Actions`.
- **Backend**: build de imagen en GHCR vía GH Actions (`Build Backend`) +
  **deploy real** por `deploy-webhook.service` en el servidor (webhook de GitHub →
  `git pull` → `docker compose build` → `up`). El job SSH antiguo se eliminó:
  `HETZNER_HOST` es una IP de Tailscale, inalcanzable desde los runners de GitHub.

### Secrets de GitHub (configurados ✅)

| Secret | Estado | Notas |
|--------|--------|-------|
| VERCEL_TOKEN | ✅ Configurado | Token sin expiración (dashboard) |
| VERCEL_ORG_ID | ✅ `team_0iXBDap6vHdalM0fEFusXlzy` | |
| VERCEL_PROJECT_ID | ✅ `prj_OpeTmO5Bs2V5DGfdH4NiThlzdTdD` | Proyecto `vidasaludable` (el id viejo `prj_4vAW…` era el proyecto `doctoraandrea`) |
| HETZNER_HOST | ⚠️ Legacy | `100.111.99.61` (Tailscale) — sin uso desde que se quitó el job SSH |
| HETZNER_USER | ⚠️ Legacy | sin uso |
| HETZNER_SSH_KEY | ⚠️ Legacy | sin uso |

**⚠️ Nota:** El token VERCEL_TOKEN debe ser creado desde https://vercel.com/account/tokens con **No expiration**. No usar el token del CLI.

### Cómo se deploya

1. `git push origin main` con cambios en `frontend/` → GH Actions `Deploy Frontend` → Vercel (builds Vercel-Git ignorados)
2. `git push origin main` con cambios en `backend/**` o `compose.prod.yaml` → GH Actions `Build Backend` (imagen GHCR) **y** `deploy-webhook.service` en Hetzner despliega (pull + compose build + up)
3. `gh workflow run "Deploy Frontend"` → deploy manual del frontend

### Verificar deploy

```bash
# Ver workflows recientes
gh run list --limit 3

# Ver deploy de Vercel
vercel ls | head -5

# Ver containers en Hetzner
ssh hetzner-ts "docker ps --filter name=vidasaludable"
```

## Documentación

- `frontend/README.md` — origen del bundle (Figma Make) e instrucciones del export original
- `guidelines/Guidelines.md` — convenciones del proyecto
