#!/bin/bash
PORT=${PORT:-9000}
OPT_DIR=${OPT_DIR:-/opt}
LOG=/var/log/deploy-webhook.log

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> $LOG; }

deploy() {
    local repo=$1
    log "Deploying $repo"
    cd /opt/$repo 2>/dev/null && {
        git fetch origin >> $LOG 2>&1
        git reset --hard origin/main >> $LOG 2>&1
        [ -f compose.prod.yaml ] && docker compose -f compose.prod.yaml up -d --build >> $LOG 2>&1
        log "Deploy complete for $repo"
    }
}

log "Webhook server started on port $PORT"

while true; do
    REQUEST=$(nc -l -p $PORT -q 1 2>/dev/null)
    BODY=$(echo "$REQUEST" | tail -1)
    REPO=$(echo "$BODY" | grep -o '"full_name":"[^"]*"' | cut -d'"' -f4)
    REF=$(echo "$BODY" | grep -o '"ref":"[^"]*"' | cut -d'"' -f4)
    
    if [ "$REF" = "refs/heads/main" ] && [ -n "$REPO" ]; then
        log "Push to main: $REPO"
        deploy "$REPO" &
    fi
done
