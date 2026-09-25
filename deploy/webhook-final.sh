#!/bin/bash
# ============================================================
# Deploy Webhook Server — Final Version
# ============================================================
# Handles HTTP correctly: reads full body before responding.
# Uses nc WITHOUT -q so the connection stays open while reading.
# Closes naturally when the processing block exits.
# ============================================================

PORT=${PORT:-9000}
SECRET=${WEBHOOK_SECRET:-}
OPT_DIR=${OPT_DIR:-/opt}
LOG=/var/log/deploy-webhook.log

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"; }

# --- HMAC signature verification ---
verify() {
    local payload="$1" sig="$2"
    [ -z "$SECRET" ] && return 0
    local expected
    expected="sha256=$(echo -n "$payload" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"
    [ "$sig" = "$expected" ]
}

# --- Deploy a project ---
deploy() {
    local repo=$1
    log "Deploying $repo"
    cd "$OPT_DIR/$repo" 2>/dev/null || { log "ERROR: $OPT_DIR/$repo not found"; return 1; }
    git fetch origin >> "$LOG" 2>&1
    git reset --hard origin/main >> "$LOG" 2>&1
    if [ -f compose.prod.yaml ]; then
        docker compose -f compose.prod.yaml up -d --build >> "$LOG" 2>&1
    fi
    log "Deploy complete for $repo"
}

# --- HTTP response helpers ---
respond() {
    local code="$1" body="$2"
    local len=${#body}
    echo -ne "HTTP/1.1 $code\r\nContent-Type: text/plain\r\nContent-Length: ${len}\r\nConnection: close\r\n\r\n${body}"
}

log "========================================="
log "Webhook server started on port $PORT"
log "Secret set: $([ -n "$SECRET" ] && echo 'yes' || echo 'no')"
log "Projects dir: $OPT_DIR"
log "========================================="

while true; do
    {
        # ---- Read HTTP request line ----
        read -r method path proto
        method="${method%%$'\r'}"
        path="${path%%$'\r'}"

        # ---- Read headers until empty line ----
        content_length=0
        signature=""
        while IFS= read -r header; do
            header="${header%%$'\r'}"
            [ -z "$header" ] && break
            [[ "$header" =~ ^Content-Length:\ *([0-9]+) ]] && content_length="${BASH_REMATCH[1]}"
            [[ "$header" =~ ^X-Hub-Signature-256:\ *(.+) ]] && signature="${BASH_REMATCH[1]}"
        done

        # ---- Read body (exactly content_length bytes) ----
        body=""
        if [ "$content_length" -gt 0 ] 2>/dev/null; then
            body=$(dd bs=1 count="$content_length" 2>/dev/null)
        fi

        # ---- Validate request ----
        if [ "$method" != "POST" ] || [ "$path" != "/webhook" ]; then
            respond "404 Not Found" "Not Found"
            log "Rejected: $method $path"
            exit 0
        fi

        # ---- Verify HMAC signature ----
        if ! verify "$body" "$signature"; then
            respond "403 Forbidden" "Forbidden"
            log "ERROR: Invalid HMAC signature"
            exit 0
        fi

        # ---- Parse payload ----
        repo=$(echo "$body" | grep -o '"full_name":"[^"]*"' | head -1 | cut -d'"' -f4)
        ref=$(echo "$body" | grep -o '"ref":"[^"]*"' | head -1 | cut -d'"' -f4)

        if [ -z "$repo" ]; then
            respond "400 Bad Request" "Bad Request"
            log "ERROR: Could not parse repo name"
            exit 0
        fi

        # ---- Deploy on push to main ----
        if [ "$ref" = "refs/heads/main" ]; then
            respond "200 OK" "Deploying $repo"
            log "Push to main: $repo — starting deploy"
            deploy "$repo" &
        else
            respond "200 OK" "OK"
            log "Ignored push to $ref for $repo"
        fi

        # Exit closes stdout → nc sees EOF → connection drops cleanly
        exit 0
    } | nc -l -p "$PORT"
done
