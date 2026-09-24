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

### Secrets de GitHub

| Secret | Descripción |
|--------|-------------|
| VERCEL_TOKEN | Token de Vercel |
| VERCEL_ORG_ID | Organización de Vercel |
| VERCEL_PROJECT_ID | Proyecto de Vercel |
| HETZNER_HOST | IP del servidor Hetzner |
| HETZNER_USER | Usuario SSH del servidor |
| HETZNER_SSH_KEY | Clave SSH privada |

## Documentación

- `frontend/README.md` — origen del bundle (Figma Make) e instrucciones del export original
- `guidelines/Guidelines.md` — convenciones del proyecto
