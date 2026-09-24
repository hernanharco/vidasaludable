#!/bin/bash
# ============================================================
# Deploy Webhook Centralizado
# ============================================================
# Un solo servidor para TODOS los proyectos en /opt/
# Detecta el repo del payload y deploya automáticamente
# ============================================================

PORT=${PORT:-9000}
SECRET=${WEBHOOK_SECRET:-}
OPT_DIR=${OPT_DIR:-/opt}
LOG_FILE=/var/log/deploy-webhook.log

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

verify_signature() {
    local payload="$1"
    local signature="$2"
    if [ -z "$SECRET" ]; then
        return 0
    fi
    local expected="sha256=$(echo -n "$payload" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"
    [ "$signature" = "$expected" ]
}

deploy_project() {
    local repo_name="$1"
    local project_dir="$OPT_DIR/$repo_name"

    log "=== Deploying $repo_name ==="

    if [ ! -d "$project_dir" ]; then
        log "ERROR: Directory $project_dir not found"
        return 1
    fi

    cd "$project_dir" || return 1

    # Git pull
    log "Git pull..."
    git fetch origin 2>&1 | tee -a "$LOG_FILE"
    git reset --hard origin/main 2>&1 | tee -a "$LOG_FILE"

    # Docker compose (si existe)
    if [ -f "compose.prod.yaml" ]; then
        log "Docker compose build..."
        docker compose -f compose.prod.yaml build 2>&1 | tee -a "$LOG_FILE"

        log "Docker compose up..."
        docker compose -f compose.prod.yaml up -d 2>&1 | tee -a "$LOG_FILE"
    elif [ -f "docker-compose.prod.yaml" ]; then
        log "Docker compose build..."
        docker compose -f docker-compose.prod.yaml build 2>&1 | tee -a "$LOG_FILE"

        log "Docker compose up..."
        docker compose -f docker-compose.prod.yaml up -d 2>&1 | tee -a "$LOG_FILE"
    else
        log "No compose file found, skipping docker"
    fi

    log "=== Deploy complete for $repo_name ==="
}

handle_request() {
    local method="" path="" content_length=0 signature=""

    while IFS= read -r line; do
        line="${line%%$'\r'}"
        [ -z "$line" ] && break

        if [[ "$line" =~ ^([A-Z]+)\ (.+)\ HTTP ]]; then
            method="${BASH_REMATCH[1]}"
            path="${BASH_REMATCH[2]}"
        elif [[ "$line" =~ ^Content-Length:\ (.+) ]]; then
            content_length="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ ^X-Hub-Signature-256:\ (.+) ]]; then
            signature="${BASH_REMATCH[1]}"
        fi
    done

    if [ "$method" != "POST" ] || [ "$path" != "/webhook" ]; then
        echo -ne "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found"
        return
    fi

    local body=""
    if [ "$content_length" -gt 0 ]; then
        body=$(head -c "$content_length")
    fi

    if ! verify_signature "$body" "$signature"; then
        log "ERROR: Invalid signature"
        echo -ne "HTTP/1.1 403 Forbidden\r\nContent-Length: 9\r\n\r\nForbidden"
        return
    fi

    # Extraer nombre del repo del payload
    local repo_name=$(echo "$body" | grep -o '"full_name":"[^"]*"' | head -1 | cut -d'"' -f4)
    local ref=$(echo "$body" | grep -o '"ref":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [ -z "$repo_name" ]; then
        log "ERROR: Could not parse repo name"
        echo -ne "HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\n\r\nBad Request"
        return
    fi

    # Solo deploy si es push a main
    if [ "$ref" = "refs/heads/main" ]; then
        log "Push to main detected for $repo_name"
        echo -ne "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK"
        deploy_project "$repo_name" &
    else
        log "Push to $ref ignored (not main)"
        echo -ne "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK"
    fi
}

log "========================================="
log "Starting centralized webhook server"
log "Port: $PORT"
log "Projects dir: $OPT_DIR"
log "========================================="

while true; do
    handle_request < <(nc -l -p "$PORT" -q 1 2>/dev/null)
done
