#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/vidasaludable}"
COMPOSE_FILE="compose.prod.yaml"
LOG_PREFIX="[deploy]"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_PREFIX} $*"; }

log "=== Deploy started ==="
log "Project dir: ${PROJECT_DIR}"

cd "$PROJECT_DIR"

log "Pulling latest from origin/main..."
git fetch origin main
git reset --hard origin/main
log "Code updated: $(git log --oneline -1)"

log "Building images (${COMPOSE_FILE})..."
docker compose -f "$COMPOSE_FILE" build

log "Restarting containers..."
docker compose -f "$COMPOSE_FILE" up -d

log "Pruning old images..."
docker image prune -f

log "=== Deploy completed ==="
