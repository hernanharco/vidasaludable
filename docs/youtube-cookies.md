# YouTube cookies: why the analysis needs them and how to renew them

The server-side video analysis acquires the artifact with `yt-dlp`. Hetzner's
datacenter IP fails YouTube's bot-check on its own (`Sign in to confirm you're
not a bot`), so the only thing that makes acquisition work is an **authenticated
cookie jar** mounted into the container.

Two separate problems live here, and they are easy to confuse:

1. **The jar is configured but unreadable** (missing file, unmounted volume,
   a directory instead of a file). The API answers `503
   youtube_cookies_unavailable` **before** claiming the analysis, so nothing is
   queued. Fix: see "Install" below.
2. **The jar is readable but its session is dead** (cookies expire every few
   weeks). The file check cannot see this: only a real extraction can. The
   analysis then answers `202` and stores the real cause in `analysis_error`
   ("Las cookies de YouTube configuradas en YT_COOKIES_PATH vencieron…").
   Fix: re-export and reinstall, or use the transcript path.

## The trap that already bit us

`yt-dlp --cookies FILE` is **read-and-dump**: on exit it rewrites the file and
prunes the Google auth family (26 → 13 cookies; `SID`, `__Secure-1PSID`,
`LOGIN_INFO` gone). The next run is bot-checked again.

Both `backend/src/tools/media.ts` and the scripts here therefore copy the master
to a disposable `<path>.run` sibling and use **that** as `--cookies`. The master
must never be the extraction target, and it must live on a writable directory
(the copy is created next to it).

## Export (operator machine, with a real browser session)

```bash
backend/scripts/export-youtube-cookies.sh chrome
```

- Exports from the browser profile (`chrome`, `firefox`, `edge`, `brave`,
  `chromium`) and writes the jar **outside the repo** (`mktemp`), so nothing
  versioned ever sees session credentials.
- Verifies the jar with a real extraction probe before telling you it is good.
- Prints the `scp` command to install it.

## Install (server)

Copy the file to the data volume, then verify **from the server**. Pass the jar
path explicitly: the probe reads `YT_COOKIES_PATH` only when you give it
nothing, and that variable is set **inside** the container, not on the host.

```bash
cd /opt/vidasaludable
./backend/scripts/check-youtube-cookies.sh data/secrets/youtube-cookies.txt
```

Exit codes: `0` ok · `1` session expired · `2` bot-check despite cookies ·
`3` configuration (missing/unreadable/not-Netscape jar) · `4` other failure.

## Watch it instead of discovering it

The probe is cron-friendly, and it is the only way to learn that the session
died **before** an operator hits it:

```cron
# /etc/cron.d/youtube-cookies — daily; logs ONLY when something is wrong.
# The `||` is load-bearing: piping into logger would replace the probe's exit
# status with logger's own, and nothing could ever alert on it.
17 6 * * * root cd /opt/vidasaludable && ./backend/scripts/check-youtube-cookies.sh data/secrets/youtube-cookies.txt >/tmp/yt-cookies.log 2>&1 || logger -t yt-cookies < /tmp/yt-cookies.log
```

Any exit other than `0` means: re-export (see above). Keep the probe rate low —
it is a real extraction, and hammering YouTube invites more throttling.

## Alternative that needs no cookies

`POST /admin/videos/:id/analyze` also accepts a pre-acquired transcript, and the
CRM's "Con transcripción…" dialog sends either form:

- `{ transcript: <json3 object> }` — `yt-dlp --write-auto-subs --sub-format json3`;
- `{ transcriptText: "<panel text>" }` — the copy you get from YouTube's
  "Transcripción" panel, timestamps and all.

Both skip `yt-dlp` entirely on the server, so neither needs a cookie jar.
