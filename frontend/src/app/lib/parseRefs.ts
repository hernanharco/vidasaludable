/**
 * Parses the stored `productReferences` wire field into a string list
 * (ui-s6 S8b). The admin recommendations log, the guidance editor and the
 * customer ficha all receive product references as a JSON-encoded string
 * array and each used to spell this helper out inline; this is the shared
 * copy with the exact historical behavior:
 *   - valid JSON array → its items stringified, order preserved;
 *   - anything else (non-array JSON, malformed JSON, empty string,
 *     null/undefined) → empty list; never throws.
 */
export function parseRefs(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
