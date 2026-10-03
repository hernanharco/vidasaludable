/**
 * Pure parsers for the video pipeline — no I/O, no subprocess, no network.
 *
 * - `parseVideoId`: extracts the YouTube id from the supported URL forms.
 * - `parseJson3Transcript`: turns a yt-dlp json3 subtitle payload into timed
 *   text lines (the "transcript line timestamps" the analyzer must align to).
 * - `parseGeminiSegments`: defensively turns the model's raw reply into
 *   validated segments (fences stripped, bounds coerced/clamped, junk dropped).
 */

/** One timed transcript line, in milliseconds (json3 native unit). */
export interface TimedCue {
  startMs: number;
  durMs: number;
  text: string;
}

/** One validated segment produced by the analyzer (integer seconds). */
export interface ParsedSegment {
  startS: number;
  endS: number;
  title: string;
  summary: string;
  condition: string;
}

/**
 * Extract the YouTube video id from a URL. Supports:
 * - `youtube.com/watch?v=ID` (with extra params such as `t=` or `list=`)
 * - `youtu.be/ID`
 * - `youtube.com/shorts/ID`
 * - `youtube.com/embed/ID`
 *
 * Returns `null` for anything that is not one of those forms.
 */
export function parseVideoId(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const patterns: RegExp[] = [
    /youtube\.com\/watch\?(?:[^#]*&)?v=([\w-]+)/i, // watch?v=ID (+ extra params)
    /youtu\.be\/([\w-]+)/i, // youtu.be/ID
    /youtube\.com\/shorts\/([\w-]+)/i, // shorts/ID
    /youtube\.com\/embed\/([\w-]+)/i, // embed/ID
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Parse a yt-dlp json3 subtitle payload into timed lines.
 *
 * Each `events[]` entry may carry `tStartMs` / `dDurationMs` and `segs[]`
 * with `utf8` fragments. Cue text = fragments concatenated, whitespace
 * collapsed, trimmed. Events with no `segs`, or whose merged text is empty
 * (line-break separators `\n` and padding spaces), are skipped.
 */
export function parseJson3Transcript(json: unknown): TimedCue[] {
  if (typeof json !== "object" || json === null) return [];
  const events = (json as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];

  const cues: TimedCue[] = [];
  for (const event of events) {
    if (typeof event !== "object" || event === null) continue;
    const e = event as { tStartMs?: unknown; dDurationMs?: unknown; segs?: unknown };
    const startMs = Number(e.tStartMs);
    if (!Number.isFinite(startMs)) continue;
    if (!Array.isArray(e.segs)) continue;

    let text = "";
    for (const seg of e.segs) {
      const utf8 = (seg as { utf8?: unknown } | null)?.utf8;
      if (typeof utf8 === "string") text += utf8;
    }
    text = text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    const durRaw = Number(e.dDurationMs);
    cues.push({ startMs, durMs: Number.isFinite(durRaw) ? durRaw : 0, text });
  }
  return cues;
}

/**
 * Defensively parse the raw Gemini reply into validated segments.
 *
 * - Strips ``` fences (with or without a `json` language tag) and, as a last
 *   resort, the outermost `{...}` span.
 * - Invalid JSON / non-array payload → `[]` with a warning (never throws).
 * - Coerces bounds to integers, drops non-finite/swapped/out-of-range bounds
 *   and empty titles, and clamps `end_s` to `durationS` when known
 *   (`durationS <= 0` means "duration unknown" → no clamping).
 */
export function parseGeminiSegments(raw: string, durationS: number): ParsedSegment[] {
  const warn = (why: string): [] => {
    console.warn(`video:analyze — respuesta de Gemini descartada: ${why}`);
    return [];
  };

  let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Fallback: extraer el primer "{" ... último "}" (Gemini a veces añade prosa).
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        data = JSON.parse(text.slice(start, end + 1));
      } catch {
        return warn("no es JSON válido");
      }
    } else {
      return warn("no es JSON válido");
    }
  }

  if (typeof data !== "object" || data === null) {
    return warn("el payload no es un objeto JSON");
  }
  const segments = (data as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) {
    return warn("falta el array segments");
  }

  const clampKnown = Number.isFinite(durationS) && durationS > 0;
  const out: ParsedSegment[] = [];
  for (const item of segments) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as { start_s?: unknown; end_s?: unknown; title?: unknown; summary?: unknown; condition?: unknown };

    const startRaw = Number(s.start_s);
    const endRaw = Number(s.end_s);
    if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) continue;
    const startS = Math.trunc(startRaw);
    let endS = Math.trunc(endRaw);

    if (startS < 0 || endS <= startS) continue; // límites invertidos o inválidos
    if (clampKnown) {
      if (startS >= durationS) continue; // el inicio ya pasó el final del video
      endS = Math.min(endS, durationS); // recorte del final fuera de rango
      if (endS <= startS) continue;
    }

    const title = typeof s.title === "string" ? s.title.trim() : "";
    if (!title) continue; // sin título no es un segmento usable

    out.push({
      startS,
      endS,
      title,
      summary: typeof s.summary === "string" ? s.summary.trim() : "",
      condition: typeof s.condition === "string" ? s.condition.trim() : "",
    });
  }
  return out;
}
