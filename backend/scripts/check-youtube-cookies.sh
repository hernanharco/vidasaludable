#!/usr/bin/env bash
# Probes the configured YouTube cookie jar and reports whether it still passes
# YouTube's bot-check — the fact the analysis preflight CANNOT know, because a
# jar can be readable (passes access/stat) while the session inside is dead.
#
# Exit codes (cron-friendly):
#   0  jar OK — extraction succeeds
#   1  session expired / cookies rejected  (cookies_invalid)
#   2  YouTube bot-check despite cookies   (anti_bot)
#   3  jar missing or unreadable           (configuration)
#   4  any other failure (video, network, geo…)
#
# Usage: ./check-youtube-cookies.sh [jar] [probe-url]
#   jar defaults to $YT_COOKIES_PATH; probe-url to a public video.
#
# The master jar is NEVER the extraction target: yt-dlp dumps and prunes its
# --cookies file on every run (prod incident 2026-10-26), so this script copies
# it to a disposable sibling and removes the copy afterwards.
set -uo pipefail

JAR="${1:-${YT_COOKIES_PATH:-}}"
PROBE_URL="${2:-https://www.youtube.com/watch?v=0RYeUT3Yl0Q}"
YTDLP="${YTDLP:-yt-dlp}"

if [ -z "$JAR" ] || [ ! -r "$JAR" ]; then
  echo "configuration: jar ausente o ilegible (${JAR:-<sin configurar>})" >&2
  exit 3
fi

# A jar that is not Netscape-format fails deep inside yt-dlp with a confusing
# "does not look like a Netscape format cookies file"; catch it here instead.
if ! grep -q "$(printf '\t')" "$JAR"; then
  echo "configuration: $JAR no parece un jar Netscape (sin columnas separadas por tab)" >&2
  exit 3
fi

command -v "$YTDLP" >/dev/null || {
  echo "configuration: '$YTDLP' no está instalado" >&2
  exit 3
}

COPY="$(mktemp -t yt-cookies-XXXXXX.txt)"
trap 'rm -f "$COPY"' EXIT
cp "$JAR" "$COPY" || {
  echo "configuration: no se pudo copiar el jar" >&2
  exit 3
}

STDERR="$(mktemp -t yt-cookies-err-XXXXXX.log)"
trap 'rm -f "$COPY" "$STDERR"' EXIT

if "$YTDLP" --js-runtimes node --cookies "$COPY" --skip-download -J "$PROBE_URL" \
    >/dev/null 2>"$STDERR"; then
  echo "ok"
  exit 0
fi

# Same signals (and order) as classifyYtdlpFailure in backend/src/tools/media.ts.
if grep -qiE "sign in to confirm you.re not a bot" "$STDERR"; then
  echo "anti_bot: YouTube bloquea la IP del servidor pese a las cookies" >&2
  exit 2
fi
if grep -qiE "cookies? are no longer valid|cookies? (have )?expired" "$STDERR"; then
  echo "expired: la sesión de las cookies venció — reexportá el jar" >&2
  exit 1
fi

echo "failed: causa no reconocida" >&2
tail -3 "$STDERR" >&2
exit 4
