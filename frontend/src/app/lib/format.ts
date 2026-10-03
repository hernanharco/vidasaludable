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
