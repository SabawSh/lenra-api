/**
 * Guard for one specific fuzzy false-positive class: a single-token tile whose
 * pronunciation is merely *embedded* inside a much longer spoken word.
 *
 * Why this is needed — worked example (`mouse` vs spoken "famous"):
 *
 *   mouse  → [m, ow, s]
 *   famous → [f, a, m, ow, s]
 *
 * The optimal weighted alignment substitutes nothing. It inserts `f`
 * (INSERT_DELETE_COST 0.32) and `a` (VOWEL_SUBSTITUTION_COST 0.15) and then
 * matches m/ow/s exactly at zero cost. Distance normalizes by
 * `max(len) * UNRELATED_SUBSTITUTION_COST` = 5, so 0.47 / 5 = 0.094 and
 * similarity = 0.906 — over the 0.9 threshold purely because insertions are
 * cheap relative to that denominator.
 *
 * That is containment, not mispronunciation: every phoneme of the tile matched
 * exactly and the extra spoken sound is simply unaccounted for. A genuine
 * mishearing instead needs substitutions ("coraline" ↔ "caroline", same length),
 * so it is unaffected by this guard.
 *
 * Deliberately NOT a length rule. Benign inflection ("girl" ↔ "girls", one extra
 * phoneme) stays acceptable; only substantially longer containment is rejected.
 *
 * Operates on the phoneme sequences the similarity score was already computed
 * from — the metric itself is untouched.
 */

/**
 * Extra spoken phonemes required before containment is treated as a different
 * word. Measured separation on real pairs:
 *   mouse/famous +2, ready/already +2  → rejected
 *   girl/girls   +1                    → still accepted
 */
export const MIN_EXTRA_PHONEMES_FOR_CONTAINMENT = 2;

/** True when every phoneme of `inner` appears in order inside `outer`. */
export function isPhonemeSubsequence(
  inner: readonly string[],
  outer: readonly string[],
): boolean {
  if (inner.length === 0 || inner.length > outer.length) return false;
  let cursor = 0;
  for (const phoneme of outer) {
    if (phoneme === inner[cursor]) cursor += 1;
    if (cursor === inner.length) return true;
  }
  return false;
}

/**
 * True when the only evidence for a single-token tile is that its pronunciation
 * sits inside a substantially longer spoken word, so the fuzzy
 * PHRASE_SIMILARITY rescue must not accept it.
 *
 * Applies only to single-token tiles: multi-token tiles are already protected by
 * the window-length rules in collectPhraseSimilarityCandidate / evaluateTile.
 */
export function isContainedSingleTokenFuzzyMatch(input: {
  tileTokenCount: number;
  expectedPhonemes: readonly string[];
  observedPhonemes: readonly string[];
}): boolean {
  if (input.tileTokenCount !== 1) return false;
  if (input.expectedPhonemes.length === 0) return false;

  const extraPhonemes =
    input.observedPhonemes.length - input.expectedPhonemes.length;
  if (extraPhonemes < MIN_EXTRA_PHONEMES_FOR_CONTAINMENT) return false;

  return isPhonemeSubsequence(input.expectedPhonemes, input.observedPhonemes);
}
