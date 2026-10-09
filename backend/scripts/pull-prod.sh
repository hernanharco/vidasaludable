#!/usr/bin/env bash
# Pull a consistent snapshot of the production SQLite database into
# backend/data/prod.sqlite so local dev can run against real data.
#
# Usage:  pnpm db:pull-prod     (from backend/)
#
# Why a .backup and not a plain `cp`:
#   Production runs SQLite in WAL mode with a live -wal file. Copying the
#   main file alone yields a stale/incomplete database (uncommitted WAL
#   frames are lost) and copying all three files while the server writes
#   them is racy. `sqlite3 .backup` performs an online, consistent snapshot
#   through SQLite's backup API, so the result is a single self-contained
#   file with no -wal/-shm sidecars.
#
# Writes land on the LOCAL COPY only — production is never touched by dev.
set -euo pipefail

REMOTE_HOST="${PROD_DB_HOST:-hetzner-ts}"
REMOTE_DB="${PROD_DB_PATH:-/opt/vidasaludable/data/dev.sqlite}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="$BACKEND_DIR/data/prod.sqlite"
TMP_LOCAL="$DEST.tmp"
TMP_REMOTE="/tmp/vidasaludable-prod-snapshot-$$.sqlite"

mkdir -p "$(dirname "$DEST")"

echo "→ Snapshot online de $REMOTE_HOST:$REMOTE_DB"
# Phase 1 — remote .backup into a per-run tmp. The backup MUST survive the ssh
# session so scp can fetch it afterwards; a trap EXIT here would delete it
# before the download (the remote shell exits as soon as this ssh returns).
# Phases are kept separate so a failed scp leaves the remote tmp behind to be
# cleaned in phase 3 instead of silently vanishing mid-pull.
ssh "$REMOTE_HOST" "sqlite3 '$REMOTE_DB' '.backup $TMP_REMOTE'"
# Phase 2 — fetch.
if ! scp -q "$REMOTE_HOST:$TMP_REMOTE" "$TMP_LOCAL"; then
  echo "✗ Falló la descarga del snapshot" >&2
  ssh "$REMOTE_HOST" "rm -f $TMP_REMOTE" || true
  rm -f "$TMP_LOCAL"
  exit 1
fi
# Phase 3 — cleanup remote tmp (best-effort: a leftover file in /tmp is
# harmless and the $$ suffix keeps concurrent runs from colliding).
ssh "$REMOTE_HOST" "rm -f $TMP_REMOTE" || true

# Local integrity check before publishing the snapshot atomically: a bad or
# truncated download must never replace a working prod.sqlite.
INTEGRITY="$(sqlite3 "$TMP_LOCAL" 'PRAGMA integrity_check;' 2>/dev/null || echo "sqlite3-missing")"
if [ "$INTEGRITY" != "ok" ]; then
  echo "✗ integrity_check falló: $INTEGRITY" >&2
  echo "  (¿Falta el binario sqlite3 local? Probá: apt install sqlite3)" >&2
  rm -f "$TMP_LOCAL"
  exit 1
fi

mv -f "$TMP_LOCAL" "$DEST"

echo "✓ $DEST ($(du -h "$DEST" | cut -f1))"
sqlite3 "$DEST" <<SQL
SELECT '  referrers: ' || count(*) FROM referrers;
SELECT '  customers: ' || count(*) FROM customers;
SELECT '  products:  ' || count(*) FROM products;
SQL
echo
echo "Ahora apuntá backend/.env a  SQLITE_PATH=./data/prod.sqlite  y reiniciá pnpm dev."
