/**
 * YouTube-style human-facing time format (T4 Phase A).
 *
 * Storage and API payloads keep integer seconds (the YouTube `&t=` deep-link
 * contract); only display layers format. `M:SS` below one hour, `H:MM:SS`
 * at or above 3600 seconds; invalid input (negative, NaN, non-finite)
 * degrades to `0:00` instead of crashing the UI.
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Deep link into the original video at a given second (YouTube `&t=`
 * contract: integer seconds plus the `s` suffix).
 *
 * Used by the admin segment table so the operator can watch the exact minute
 * before deciding whether a segment gets a condition. Without a video id
 * there is nothing to link to, so the caller renders plain text instead.
 * Invalid input (negative, NaN, non-finite) degrades to the video start
 * instead of producing a broken URL.
 *
 * The id is typed nullable on purpose: the field is required in the `Video`
 * contract, but a payload that omits it would otherwise throw mid-render of
 * the segment table (review finding R3-NullTrim).
 */
export function youtubeTimestampUrl(
  youtubeId: string | null | undefined,
  seconds: number,
): string | null {
  const id = typeof youtubeId === "string" ? youtubeId.trim() : "";
  if (!id) return null;
  const at = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&t=${at}s`;
}
