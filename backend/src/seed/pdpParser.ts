/**
 * PDP section extractor (catalog-video-products T2).
 *
 * The official amway.es product pages (fetched via the Jina keyless reader,
 * `https://r.jina.ai/https://www.amway.es/<slug>/p/<ref>`) embed their
 * accordion-tab content ("Vista general", "Detalles", "Uso recomendado"…)
 * as JSON fragments in the page payload, e.g.:
 *
 *   {"code":"details_110606W","content":"\u003cp\u003e…\u003c/p\u003e",
 *    "sectionType":"Detalles","visibleForCurrentUser":true,…}
 *
 * `content` is a JSON string body carrying `\uXXXX` escapes and HTML tags.
 * These fragments are the ONLY place the "Uso sugerido / Dosis recomendada",
 * "Aviso" and "INGREDIENTES" texts live — the rendered markdown view hides
 * them behind the tabs. This module decodes them verbatim; it never invents
 * text and yields an empty list when a page carries no section payload.
 */
export interface PdpSection {
  /** Tab label from the payload ("Detalles", "Vista general", …). */
  sectionType: string;
  /** Decoded, HTML-stripped, whitespace-normalized section text. */
  text: string;
}

/**
 * Matches one section JSON fragment in either payload order:
 *   {"code":"…","content":"…","sectionType":"…"}
 *   {"code":"…","content":"…","sectionTypeCode":"…"}
 * The content body is captured JSON-string-safe (`[^"\\]|\\.`).
 */
const SECTION_RE =
  /\{"(?:code":"[^"]*","content":"((?:[^"\\]|\\.)*)","sectionType":"([^"]*)"|code":"[^"]*","content":"((?:[^"\\]|\\.)*)","sectionTypeCode":"([^"]*)")/g;

/** Decode a JSON string body (without the surrounding quotes). */
function decodeJsonStringBody(body: string): string {
  try {
    return JSON.parse(`"${body}"`) as string;
  } catch {
    // Defensive fallback for malformed escapes — still a verbatim decode.
    return body
      .replace(
        /\\u([0-9a-fA-F]{4})/g,
        (_m: string, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n");
  }
}

/** Strip HTML tags and collapse whitespace. */
function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract every embedded section payload from raw PDP HTML, in document
 * order. Duplicate fragments (RSC stream + hydration copy) collapse to one
 * entry keyed by (sectionType, text).
 */
export function extractPdpSections(html: string): PdpSection[] {
  const out: PdpSection[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(SECTION_RE)) {
    const body = m[1] ?? m[3] ?? "";
    const sectionType = m[2] ?? m[4] ?? "(sin tipo)";
    const text = stripHtml(decodeJsonStringBody(body));
    if (!text) continue;
    const key = `${sectionType}::${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sectionType, text });
  }
  return out;
}
