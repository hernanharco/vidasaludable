/**
 * Pure parsers for the video pipeline — no I/O, no subprocess, no network.
 *
 * - `parseVideoId`: extracts the YouTube id from the supported URL forms.
 * - `parseJson3Transcript`: turns a yt-dlp json3 subtitle payload into timed
 *   text lines (the "transcript line timestamps" the analyzer must align to).
 * - `parsePanelTranscript`: turns the human-readable text copied from
 *   YouTube's "Transcripción" panel into a json3-shaped object, so an
 *   operator can paste what the YouTube UI shows instead of the artifact.
 * - `parseGeminiSegments`: defensively turns the model's raw reply into
 *   validated segments (fences stripped, bounds coerced/clamped, junk dropped)
 *   including the per-segment product mentions linked to the injected catalog.
 */

/** One timed transcript line, in milliseconds (json3 native unit). */
export interface TimedCue {
  startMs: number;
  durMs: number;
  text: string;
}

/** One product mention inside a segment (T5), already validated. */
export interface ParsedProduct {
  mention: string; // verbatim (trimmed) product name the educator said
  ref: string; // catalog ref — "" when the ref was empty or NOT in the catalog
}

/** One validated segment produced by the analyzer (integer seconds). */
export interface ParsedSegment {
  startS: number;
  endS: number;
  title: string;
  summary: string;
  condition: string;
  products: ParsedProduct[]; // T5: mentions extracted from this segment
}

/**
 * Extract the YouTube video id from a URL. Supports:
 * - `youtube.com/watch?v=ID` (with extra params such as `t=` or `list=`,
 *   and the trailing slash YouTube sometimes emits: `/watch/?v=`)
 * - `youtu.be/ID`
 * - `youtube.com/{shorts,embed,live,v}/ID`
 * - the bare 11-character id (the admin form is often filled with just that)
 *
 * Returns `null` for anything that is not one of those forms.
 */
export function parseVideoId(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const patterns: RegExp[] = [
    /youtube\.com\/watch\/?\?(?:[^#]*&)?v=([\w-]+)/i, // watch?v=ID (+ extra params)
    /youtu\.be\/([\w-]+)/i, // youtu.be/ID
    /youtube\.com\/(?:shorts|embed|live|v)\/([\w-]+)/i, // shorts|embed|live|v/ID
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }
  // A bare id is unambiguous enough to accept: 11 chars of the YouTube alphabet.
  const bare = trimmed.match(/^([\w-]{11})$/);
  return bare?.[1] ?? null;
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
 * A json3-shaped payload produced from a pasted YouTube panel transcript.
 * Structurally identical to the yt-dlp json3 subset the pipeline consumes,
 * so `parseJson3Transcript` accepts it unchanged.
 */
export interface PanelTranscriptJson {
  events: Array<{
    tStartMs: number;
    dDurationMs: number;
    segs: Array<{ utf8: string }>;
  }>;
}

/**
 * A panel line that is only a cue timestamp: `M:SS` or `H:MM:SS`.
 * Anchored full-line match — any surrounding text makes it a text line.
 */
const PANEL_TIMESTAMP_RE = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/;

/**
 * A panel line that is only a duration: "11 segundos",
 * "1 minuto y 5 segundos", "2 horas, 5 minutos y 3 segundos",
 * "1 hora y 8 segundos" or "5 minutos". Anchored full-line match; only one
 * alternative can win. Capture groups by alternative:
 * 1 horas, 2 minutos, 3 segundos | 4 minutos, 5 segundos |
 * 6 segundos | 7 minutos.
 */
const PANEL_DURATION_RE =
  /^(?:(\d+)\s+horas?)\s*,?\s*(?:(\d+)\s+minutos?)?\s*(?:y\s+)?(\d+)\s+segundos?$|^(?:(\d+)\s+minutos?)\s+y\s+(\d+)\s+segundos$|^(\d+)\s+segundos?$|^(\d+)\s+minutos?$/i;

/** Timestamp line (`M:SS` / `H:MM:SS`) → milliseconds; `null` if not one. */
function panelTimestampMs(line: string): number | null {
  const m = PANEL_TIMESTAMP_RE.exec(line);
  if (!m) return null;
  const isHms = m[3] !== undefined; // 3 parts → H:MM:SS, 2 parts → M:SS
  const hours = isHms ? Number(m[1] ?? 0) : 0;
  const minutes = isHms ? Number(m[2] ?? 0) : Number(m[1] ?? 0);
  const seconds = isHms ? Number(m[3] ?? 0) : Number(m[2] ?? 0);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/** Duration line → milliseconds; `null` if the line is not a duration. */
function panelDurationMs(line: string): number | null {
  const m = PANEL_DURATION_RE.exec(line);
  if (!m) return null;
  const hours = Number(m[1] ?? 0);
  const minutes = Number(m[2] ?? m[4] ?? m[7] ?? 0);
  const seconds = Number(m[3] ?? m[5] ?? m[6] ?? 0);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/** Fallback duration for the LAST cue when the panel gave no duration line. */
const PANEL_LAST_CUE_FALLBACK_MS = 2000;

/**
 * Convert the human-readable text copied from YouTube's "Transcripción"
 * panel into a json3-shaped object, so the pipeline consumes it exactly
 * like a yt-dlp artifact (`parseJson3Transcript` accepts it unchanged).
 *
 * Contract (real panel copy):
 * - A line that is only a timestamp (`M:SS` / `H:MM:SS`) opens a cue.
 * - A duration line right after the timestamp ("11 segundos",
 *   "1 minuto y 5 segundos", "2 horas, 5 minutos y 3 segundos",
 *   "5 minutos") is the cue's `dDurationMs` — NEVER cue text.
 * - Every other non-empty line until the next timestamp is cue text;
 *   consecutive lines join with a single space.
 * - Text before the first timestamp (panel headers) is discarded.
 * - No duration line → `nextCueStart - thisStart` clamped at 0; the last
 *   cue falls back to 2000 ms. Never negative.
 * - Cues whose text is empty after trimming are dropped.
 * - Bracketed noise ("[música]", "[aplausos]") is kept as text verbatim.
 *
 * Pure function, no I/O. Throws a Spanish Error when the input yields zero
 * cues (not a valid panel transcript); the route maps that to a 400.
 */
export function parsePanelTranscript(raw: string): PanelTranscriptJson {
  interface Draft {
    startMs: number;
    durMs: number | null; // explicit duration line, when present
    textLines: string[];
  }

  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let afterTimestamp = false; // the NEXT non-empty line may be the duration

  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue; // blank separators never change the state

    const startMs = panelTimestampMs(text);
    if (startMs !== null) {
      current = { startMs, durMs: null, textLines: [] };
      drafts.push(current);
      afterTimestamp = true;
      continue;
    }

    if (current !== null && afterTimestamp) {
      afterTimestamp = false;
      const durMs = panelDurationMs(text);
      if (durMs !== null) {
        current.durMs = durMs;
        continue; // consumed as duration — never emitted as text
      }
    }
    afterTimestamp = false;

    if (current === null) continue; // header lines before the first timestamp
    current.textLines.push(text);
  }

  const events: PanelTranscriptJson["events"] = [];
  for (const [index, draft] of drafts.entries()) {
    const text = draft.textLines.join(" ").trim();
    if (!text) continue; // cue without text is not a cue
    const next = drafts[index + 1];
    const derived = next ? next.startMs - draft.startMs : PANEL_LAST_CUE_FALLBACK_MS;
    const dDurationMs = draft.durMs ?? Math.max(0, derived); // never negative
    events.push({ tStartMs: draft.startMs, dDurationMs, segs: [{ utf8: text }] });
  }

  if (events.length === 0) {
    throw new Error(
      "transcripción del panel inválida: no se encontró ningún cue con timestamp (se esperaba el texto copiado de la transcripción de YouTube)",
    );
  }
  return { events };
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
 * - Products (T5): each `products[]` entry must be an object with a non-empty
 *   trimmed string `mention`. The `ref` survives ONLY when it exists in
 *   `catalogRefs` — the refs injected into the analyze prompt from the
 *   products table. Defensive by design: an unknown/empty ref is dropped
 *   (kept as `""`), the mention stays raw. Entries are skipped outright when
 *   the mention is missing/blank, whatever the ref says.
 */
export interface SegmentsParseResult {
  /** Every segment that survived validation. */
  segments: ParsedSegment[];
  /**
   * Why `segments` is empty, or `null` when at least one survived. The caller
   * puts this in the row message: the old single "sin segmentos utilizables"
   * string could not tell a truncated reply from bounds that ate every segment.
   */
  problem: string | null;
  /** Raw reply length in characters (diagnostics only). */
  rawLength: number;
}

/**
 * Truncation probe: walks the text outside string literals and reports an
 * unbalanced structure or an unterminated string. A cut JSON keeps its braces
 * open, which `JSON.parse` can only report as "invalid" — the distinction
 * matters because a truncated reply needs a bigger output budget, not a
 * different prompt.
 */
function looksTruncatedJson(text: string): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
  }
  return depth > 0 || inString;
}

/** Bounded head+tail of the raw reply: enough to see the shape, never the whole payload. */
function rawSnippet(raw: string): string {
  const head = raw.slice(0, 200);
  const tail = raw.length > 320 ? raw.slice(-120) : "";
  return ` [len=${raw.length} cabeza=${JSON.stringify(head)}${tail ? ` cola=${JSON.stringify(tail)}` : ""}]`;
}

/**
 * Classifies a FAILED payload. It receives the rescued fragment (from the first
 * `{`), never the prose preamble: the preamble's own braces used to skew the
 * count, and gating on `startsWith("{")` mislabeled a prose-prefixed truncated
 * reply as "not JSON" — the very incident this diagnostics exists to name.
 * Requiring the `segments` key keeps a stray brace in prose from reading as a
 * truncation.
 */
function describeMalformed(fragment: string): string {
  const len = fragment.length;
  if (fragment.includes('"segments"') && looksTruncatedJson(fragment)) {
    return `respuesta truncada (${len} caracteres, la estructura JSON quedó abierta)`;
  }
  return `no es JSON válido (${len} caracteres)`;
}

/**
 * Same contract as `parseGeminiSegments`, plus the cause when nothing
 * survives. The parser is silent by design about single segments (one bad item
 * must not fail the run), so the aggregated reason is the only diagnostic the
 * operator gets.
 */
export function parseGeminiSegmentsResult(
  raw: string,
  durationS: number,
  catalogRefs: string[] = [],
): SegmentsParseResult {
  const rawLength = raw.length;
  const fail = (problem: string): SegmentsParseResult => {
    console.warn(`video:analyze — respuesta de Gemini descartada: ${problem}${rawSnippet(raw)}`);
    return { segments: [], problem, rawLength };
  };
  const succeed = (segments: ParsedSegment[]): SegmentsParseResult => ({
    segments,
    problem: null,
    rawLength,
  });

  let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!text) {
    return fail("la respuesta vino vacía (0 caracteres)");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Fallback: extraer el primer "{" ... último "}" (Gemini a veces añade prosa).
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const fragment = start >= 0 ? text.slice(start, end > start ? end + 1 : undefined) : text;
    if (start >= 0 && end > start) {
      try {
        data = JSON.parse(fragment);
      } catch {
        return fail(describeMalformed(fragment));
      }
    } else {
      return fail(describeMalformed(fragment));
    }
  }

  if (typeof data !== "object" || data === null) {
    return fail("el payload no es un objeto JSON");
  }
  const segments = (data as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) {
    return fail("falta el array segments");
  }
  if (segments.length === 0) {
    return fail("el modelo devolvió el array segments vacío");
  }

  const clampKnown = Number.isFinite(durationS) && durationS > 0;
  const knownRefs = new Set(catalogRefs);
  const out: ParsedSegment[] = [];
  // Per-reason counters. A single bad item must not fail the run, so each
  // rejection is a silent `continue`; without the tally an empty result said
  // nothing about WHY every segment died (units drift, wrong row duration, …).
  const dropped = { shape: 0, bounds: 0, title: 0 };
  for (const item of segments) {
    if (typeof item !== "object" || item === null) {
      dropped.shape += 1;
      continue;
    }
    const s = item as {
      start_s?: unknown;
      end_s?: unknown;
      title?: unknown;
      summary?: unknown;
      condition?: unknown;
      products?: unknown;
    };

    const startRaw = Number(s.start_s);
    const endRaw = Number(s.end_s);
    if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) {
      dropped.bounds += 1;
      continue;
    }
    const startS = Math.trunc(startRaw);
    let endS = Math.trunc(endRaw);

    if (startS < 0 || endS <= startS) {
      dropped.bounds += 1;
      continue; // límites invertidos o inválidos
    }
    if (clampKnown) {
      if (startS >= durationS) {
        dropped.bounds += 1;
        continue; // el inicio ya pasó el final del video
      }
      endS = Math.min(endS, durationS); // recorte del final fuera de rango
      if (endS <= startS) {
        dropped.bounds += 1;
        continue;
      }
    }

    const title = typeof s.title === "string" ? s.title.trim() : "";
    if (!title) {
      dropped.title += 1;
      continue; // sin título no es un segmento usable
    }

    // T5: productos mencionados — mention recortada no vacía; el ref solo
    // sobrevive si existe en el catálogo inyectado (anti-invención).
    const products: ParsedProduct[] = [];
    if (Array.isArray(s.products)) {
      for (const entry of s.products) {
        if (typeof entry !== "object" || entry === null) continue;
        const p = entry as { mention?: unknown; ref?: unknown };
        const mention = typeof p.mention === "string" ? p.mention.trim() : "";
        if (!mention) continue; // sin mention no hay producto utilizable
        const refRaw = typeof p.ref === "string" ? p.ref.trim() : String(p.ref ?? "").trim();
        products.push({ mention, ref: refRaw && knownRefs.has(refRaw) ? refRaw : "" });
      }
    }

    out.push({
      startS,
      endS,
      title,
      summary: typeof s.summary === "string" ? s.summary.trim() : "",
      condition: typeof s.condition === "string" ? s.condition.trim() : "",
      products,
    });
  }

  if (out.length === 0) {
    return fail(
      `${segments.length} de ${segments.length} segmentos descartados` +
        ` (forma=${dropped.shape}, límites=${dropped.bounds}, título=${dropped.title}` +
        `; duración=${clampKnown ? `${durationS}s` : "desconocida"})`,
    );
  }
  return succeed(out);
}

/**
 * Backwards-compatible view of {@link parseGeminiSegmentsResult}: callers that
 * only need the segments keep the old signature and behavior.
 */
export function parseGeminiSegments(
  raw: string,
  durationS: number,
  catalogRefs: string[] = [],
): ParsedSegment[] {
  return parseGeminiSegmentsResult(raw, durationS, catalogRefs).segments;
}
