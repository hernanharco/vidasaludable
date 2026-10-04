/**
 * Symptom matcher — pure normalization + best-match resolution.
 *
 * The pipeline writes free-text conditions extracted from video transcripts
 * (e.g. "dolor en las articulaciones, artritis"). Those must be resolved to a
 * row of the 95-symptom assessment vocabulary (`assessment_symptoms`, source
 * of truth: src/seed/assessment_seed_data.json) so a segment can be injected
 * into the assistant for the matching user symptoms.
 *
 * Matching is deliberately conservative and explainable:
 *
 * 1. Both sides are normalized (lowercase → strip diacritics → punctuation and
 *    repeated whitespace collapse to single spaces → trim).
 * 2. The best candidate is the one that is equal to the input after
 *    normalization, or that contains the input, or that the input contains.
 * 3. Nothing comparable → `null`. An unmatched segment keeps `condition=NULL`
 *    and needs an admin assignment before it can be approved.
 */

/** Shape of a symptom candidate — matches `assessment_symptoms` rows. */
export interface SymptomCandidate {
  id: number;
  name_es: string;
}

/**
 * Normalize free text for comparison: lowercase, strip accents/diacritics, and
 * turn any run of punctuation/symbols/whitespace into a single space.
 *
 * "¡Dolores   de cabeza!" → "dolores de cabeza"
 * "Migrañas ñandú"       → "migranas nandu"
 */
export function normalizeSymptomText(input: string): string {
  return input
    .normalize("NFD") // decompose accented glyphs into base letter + combining mark
    .replace(/[\u0300-\u036f]/g, "") // drop the combining marks (accents)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ") // punctuation/symbols → one space
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve free text to the best symptom in `symptoms`, or `null`.
 *
 * Tie-breaking on the containment branches:
 * - name contains input (the input is a fragment) → prefer the SHORTEST name,
 *   i.e. the most specific symptom that still fits the fragment;
 * - input contains name (the input mentions a whole symptom) → prefer the
 *   LONGEST name, i.e. the most informative symptom carried by the input.
 * An exact post-normalization match always wins over either.
 *
 * Pure: no DB access, no side effects.
 */
export function matchSymptom(
  input: string,
  symptoms: SymptomCandidate[],
): SymptomCandidate | null {
  const needle = normalizeSymptomText(input);
  // An empty normalized needle is contained in every name — bail out early so
  // blank/punctuation-only input can never match something arbitrary.
  if (!needle) return null;

  const EXACT = 3;
  let best: SymptomCandidate | null = null;
  let bestScore = -Infinity;

  for (const symptom of symptoms) {
    const name = normalizeSymptomText(symptom.name_es);
    if (!name) continue;

    let score: number;
    if (name === needle) {
      score = EXACT;
    } else if (name.includes(needle)) {
      // Shorter name → more specific. Fractional term breaks length ties.
      score = 2 - name.length / 1e6;
    } else if (needle.includes(name)) {
      // Longer name → more informative. Fractional term breaks length ties.
      score = 1 + name.length / 1e6;
    } else {
      continue;
    }

    if (score > bestScore) {
      bestScore = score;
      best = symptom;
    }
  }

  // Hand back the original entry (not the normalized copy) so callers keep the
  // accented display name and any extra fields.
  return best;
}
