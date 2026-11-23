#!/usr/bin/env bash
# Exports a FRESH YouTube cookie jar from a local browser and verifies it with a
# real extraction probe, so the operator knows the file works BEFORE shipping it
# to the server.
#
# Why a local browser: the server has no browser session. Its datacenter IP is
# bot-checked by YouTube, so the authenticated cookie jar is the only thing that
# makes server-side acquisition work (prod incident 2026-11-22: expired cookies
# were reported to the admin as "check the URL and the installation").
#
# Usage: ./export-youtube-cookies.sh [browser] [probe-url]
#   browser:   chrome | firefox | edge | brave | chromium  (default: chrome)
#   probe-url: any public video used to prove the jar works
#
# The exported jar contains live session credentials: it is written OUTSIDE the
# repository, next to nothing versioned, and never committed.
set -euo pipefail

BROWSER="${1:-chrome}"
PROBE_URL="${2:-https://www.youtube.com/watch?v=0RYeUT3Yl0Q}"
OUT="${OUT:-$(mktemp -t youtube-cookies-XXXXXX.txt)}"
YTDLP="${YTDLP:-yt-dlp}"

command -v "$YTDLP" >/dev/null || {
  echo "ERROR: '$YTDLP' no está instalado. Instalalo con: python3 -m pip install 'yt-dlp[default]'" >&2
  exit 127
}

echo "[1/2] Exportando cookies de $BROWSER → $OUT"
# --cookies is read-AND-DUMP: yt-dlp rewrites the jar on exit and PRUNES the
# Google auth family (26 → 13 cookies, SID/LOGIN_INFO gone). That is why the
# export target is used once here and the PROBE below works on a copy.
"$YTDLP" --cookies-from-browser "$BROWSER" --cookies "$OUT" \
  --skip-download -J "$PROBE_URL" >/dev/null

echo "[2/2] Verificando el jar con una extracción real (sobre una copia)"
PROBE_COPY="$OUT.run"
cp "$OUT" "$PROBE_COPY"   # the probe dumps into its target; never the master
trap 'rm -f "$PROBE_COPY"' EXIT

if "$YTDLP" --cookies "$PROBE_COPY" --skip-download -J "$PROBE_URL" >/dev/null 2>"$OUT.err"; then
  echo "OK: el jar pasa la extracción."
else
  echo "FALLA: el jar no pasa la extracción. Detalle:" >&2
  tail -3 "$OUT.err" >&2
  echo "" >&2
  echo "Si dice 'Sign in to confirm you're not a bot', la sesión exportada no es válida:" >&2
  echo "abrí YouTube en $BROWSER, logueate, y volvé a correr este script." >&2
  exit 1
fi

cat <<EOF

Jar listo: $OUT

Instalalo en el servidor (el maestro se copia por extracción, nunca se edita in situ):

  scp "$OUT" root@<host-tailnet>:/opt/vidasaludable/data/secrets/youtube-cookies.txt

(El host y el usuario están en la documentación privada de infraestructura, no acá:
 el repo no versiona datos de acceso.)

Y verificá desde el servidor:

  cd /opt/vidasaludable && ./backend/scripts/check-youtube-cookies.sh
EOF
