#!/bin/bash
# ============================================================
# Deploy Webhook Centralizado v2
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

    log "Git pull..."
    git fetch origin 2>&1 | tee -a "$LOG_FILE"
    git reset --hard origin/main 2>&1 | tee -a "$LOG_FILE"

    if [ -f "compose.prod.yaml" ]; then
        log "Docker compose build..."
        docker compose -f compose.prod.yaml build 2>&1 | tee -a "$LOG_FILE"
        log "Docker compose up..."
        docker compose -f compose.prod.yaml up -d 2>&1 | tee -a "$LOG_FILE"
    fi

    log "=== Deploy complete for $repo_name ==="
}

handle_client() {
    local client_fd=$1

    # Read HTTP request
    local method="" path="" content_length=0 signature="" body=""
    local line=""
    
    while IFS= read -r line <&$client_fd; do
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
    done <&$client_fd

    if [ "$method" != "POST" ] || [ "$path" != "/webhook" ]; then
        echo -ne "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found" >&$client_fd
        exec {client_fd}>&-
        return
    fi

    if [ "$content_length" -gt 0 ]; then
        body=$(head -c "$content_length" <&$client_fd)
    fi

    if ! verify_signature "$body" "$signature"; then
        log "ERROR: Invalid signature"
        echo -ne "HTTP/1.1 403 Forbidden\r\nContent-Length: 9\r\n\r\nForbidden" >&$client_fd
        exec {client_fd}>&-
        return
    fi

    local repo_name=$(echo "$body" | grep -o '"full_name":"[^"]*"' | head -1 | cut -d'"' -f4)
    local ref=$(echo "$body" | grep -o '"ref":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [ -z "$repo_name" ]; then
        log "ERROR: Could not parse repo name"
        echo -ne "HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\n\r\nBad Request" >&$client_fd
        exec {client_fd}>&-
        return
    fi

    if [ "$ref" = "refs/heads/main" ]; then
        log "Push to main detected for $repo_name"
        echo -ne "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK" >&$client_fd
        deploy_project "$repo_name" &
    else
        log "Push to $ref ignored (not main)"
        echo -ne "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK" >&$client_fd
    fi
    
    exec {client_fd}>&-
}

log "========================================="
log "Starting centralized webhook server v2"
log "Port: $PORT"
log "Projects dir: $OPT_DIR"
log "========================================="

# Use socat if available, otherwise fall back to nc
if command -v socat &> /dev/null; then
    log "Using socat"
    while true; do
        socat TCP-LISTEN:$PORT,fork,reuseaddr SYSTEM:'
            method=""; path=""; content_length=0; signature=""; body=""
            while IFS= read -r line; do
                line="${line%%\r}"
                [ -z "$line" ] && break
                if [[ "$line" =~ ^([A-Z]+)\ (.+)\ HTTP ]]; then
                    method="${BASH_REMATCH[1]}"; path="${BASH_REMATCH[2]}"
                elif [[ "$line" =~ ^Content-Length:\ (.+) ]]; then
                    content_length="${BASH_REMATCH[1]}"
                elif [[ "$line" =~ ^X-Hub-Signature-256:\ (.+) ]]; then
                    signature="${BASH_REMATCH[1]}"
                fi
            done
            if [ "$content_length" -gt 0 ]; then
                body=$(head -c "$content_length")
            fi
            repo_name=$(echo "$body" | grep -o "\"full_name\":\"[^\"]*\"" | head -1 | cut -d"\"" -f4)
            ref=$(echo "$body" | grep -o "\"ref\":\"[^\"]*\"" | head -1 | cut -d"\"" -f4)
            if [ "$method" = "POST" ] && [ "$path" = "/webhook" ] && [ "$ref" = "refs/heads/main" ] && [ -n "$repo_name" ]; then
                echo -ne "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK"
                (cd /opt/$repo_name && git fetch origin && git reset --hard origin/main && docker compose -f compose.prod.yaml build && docker compose -f compose.prod.yaml up -d) >> /var/log/deploy-webhook.log 2>&1 &
            else
                echo -ne "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK"
            fi
        ' 2>/dev/null
    done
else
    log "Using nc (fallback)"
    while true; do
        {
            read -r request
            content_length=0
            signature=""
            while IFS= read -r header; do
                header="${header%%$'\r'}"
                [ -z "$header" ] && break
                [[ "$header" =~ ^Content-Length:\ (.+) ]] && content_length="${BASH_REMATCH[1]}"
                [[ "$header" =~ ^X-Hub-Signature-256:\ (.+) ]] && signature="${BASH_REMATCH[1]}"
            done
            
            body=""
            [ "$content_length" -gt 0 ] && body=$(head -c "$content_length")
            
            repo_name=$(echo "$body" | grep -o '"full_name":"[^"]*"' | head -1 | cut -d'"' -f4)
            ref=$(echo "$body" | grep -o '"ref":"[^"]*"' | head -1 | cut -d'"' -f4)
            
            if [[ "$request" =~ ^POST\ /webhook\ HTTP ]] && [ "$ref" = "refs/heads/main" ] && [ -n "$repo_name" ]; then
                echo -ne "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK"
                (cd "/opt/$repo_name" && git fetch origin && git reset --hard origin/main && docker compose -f compose.prod.yaml build && docker compose -f compose.prod.yaml up -d) >> /var/log/deploy-webhook.log 2>&1 &
            else
                echo -ne "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK"
            fi
        } | nc -l -p $PORT -q 1 > /dev/null 2>&1
    done
fi
