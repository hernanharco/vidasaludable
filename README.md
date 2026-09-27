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

- **Frontend**: Vercel (automático al push a main)
- **Backend**: Hetzner vía Docker (automático al push a main)

### Secrets de GitHub (configurados ✅)

| Secret | Estado | Notas |
|--------|--------|-------|
| VERCEL_TOKEN | ✅ Configurado | Token sin expiración (dashboard) |
| VERCEL_ORG_ID | ✅ `team_0iXBDap6vHdalM0fEFusXlzy` | |
| VERCEL_PROJECT_ID | ✅ `prj_4vAW3At3CGFwq6MzA56ZV6A50Xi3` | |
| HETZNER_HOST | ✅ `100.111.99.61` | Tailscale IP |
| HETZNER_USER | ✅ `root` | |
| HETZNER_SSH_KEY | ✅ Configurado | |

**⚠️ Nota:** El token VERCEL_TOKEN debe ser creado desde https://vercel.com/account/tokens con **No expiration**. No usar el token del CLI.

### Cómo se deploya

1. `git push origin main` con cambios en `frontend/` → deploy automático a Vercel
2. `git push origin main` con cambios en `backend/` → build Docker + deploy a Hetzner
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
