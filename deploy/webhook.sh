#!/bin/bash
# ============================================================
# Deploy Webhook - Bash puro (sin Node.js)
# ============================================================
# Escucha en un puerto y ejecuta deploy.sh al recibir un push a main
# Uso: ./webhook.sh

PORT=${PORT:-9000}
SECRET=${WEBHOOK_SECRET:-}
PROJECT_DIR=${PROJECT_DIR:-/opt/vidasaludable}

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

verify_signature() {
    local payload="$1"
    local signature="$2"
    if [ -z "$SECRET" ]; then
        return 0  # Sin secret, permitir todo (solo para testing)
    fi
    local expected="sha256=$(echo -n "$payload" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"
    [ "$signature" = "$expected" ]
}

handle_request() {
    local method="" path="" content_length=0 signature=""
    
    # Leer headers HTTP
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
    
    # Solo aceptar POST /webhook
    if [ "$method" != "POST" ] || [ "$path" != "/webhook" ]; then
        echo -ne "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"
        return
    fi
    
    # Leer body
    local body=""
    if [ "$content_length" -gt 0 ]; then
        body=$(head -c "$content_length")
    fi
    
    # Verificar signature
    if ! verify_signature "$body" "$signature"; then
        log "ERROR: Invalid signature"
        echo -ne "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"
        return
    fi
    
    # Verificar que es push a main
    if echo "$body" | grep -q '"refs/heads/main"'; then
        log "Push to main detected, deploying..."
        echo -ne "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"
        # Ejecutar deploy en background
        (cd "$PROJECT_DIR" && bash deploy.sh >> /var/log/deploy-webhook.log 2>&1) &
    else
        log "Not a push to main, ignoring"
        echo -ne "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"
    fi
}

log "Starting webhook server on port $PORT"
log "Project dir: $PROJECT_DIR"

# Crear named pipe para comunicación
PIPE=/tmp/webhook_pipe_$$
mkfifo "$PIPE" 2>/dev/null || true

# Usar netcat para escuchar
while true; do
    handle_request < <(nc -l -p "$PORT" -q 1 2>/dev/null < "$PIPE")
done
