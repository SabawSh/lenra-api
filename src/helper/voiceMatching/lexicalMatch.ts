import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import { tokenMatchForms } from "@/helper/speech/voiceMatchLexicon";
import { levenshtein } from "@/utils/pronunciation";
import { normalizeToken } from "./textUtils";

function lexicalSimilaritySingle(expectedForm: string, spoken: string): number {
  const expectedNorm = normalizeToken(expectedForm);
  const spokenNorm = normalizeToken(spoken);

  if (!expectedNorm || !spokenNorm) return 0;
  if (expectedNorm === spokenNorm) return 1;

  const distance = levenshtein(expectedNorm, spokenNorm);
  const maxLen = Math.max(expectedNorm.length, spokenNorm.length);

  return Math.max(0, 1 - distance / maxLen);
}

/**
 * Lexical similarity for diagnostics only.
 * Never used as a decision by the evidence gate.
 */
export function lexicalSimilarity(
  expected: string,
  spoken: string,
  lexicon?: VoiceMatchLexicon,
): number {
  let best = 0;
  for (const form of tokenMatchForms(lexicon, expected)) {
    best = Math.max(best, lexicalSimilaritySingle(form, spoken));
  }
  return best;
}

/**
 * Lexical evidence comes in two strengths, and the difference decides whether a
 * tile may be accepted as a hard tier-1 `GATE_MATCH`.
 *
 * `exact` — the spoken token *is* the tile token or one of its registered
 * lexicon forms (built at puzzle creation from CMUdict; the matcher never
 * regenerates surfaces). This is proof the word was spoken.
 *
 * `typo` — the two surfaces are merely one substitution apart. That is an
 * observation about spelling, not proof of what was spoken: English minimal
 * pairs are exactly one substitution apart ("mouse"/"house", "light"/"night",
 * "think"/"thing"). Treating it as hard evidence let distinct words satisfy the
 * evidence gate. It remains available as soft evidence, where pronunciation —
 * not spelling — decides the outcome.
 */
export type LexicalEvidenceStrength = "none" | "typo" | "exact";

function lexicalEvidenceStrengthSingle(
  expectedForm: string,
  spoken: string,
): LexicalEvidenceStrength {
  const expectedNorm = normalizeToken(expectedForm);
  const spokenNorm = normalizeToken(spoken);

  if (!expectedNorm || !spokenNorm) return "none";

  if (expectedNorm === spokenNorm) return "exact";

  const expectedLen = expectedNorm.length;
  const spokenLen = spokenNorm.length;

  if (Math.abs(expectedLen - spokenLen) > 1) {
    return "none";
  }

  if (expectedLen <= 4 || spokenLen <= 4) {
    return "none";
  }

  // One-edit typos must stay same length so insert/delete pairs (e.g. other↔mother)
  // never pass as substitutions-only matches.
  if (levenshtein(expectedNorm, spokenNorm) === 1 && expectedLen === spokenLen) {
    return "typo";
  }

  return "none";
}

export function lexicalEvidenceStrength(
  expected: string,
  spoken: string,
  lexicon?: VoiceMatchLexicon,
): LexicalEvidenceStrength {
  let best: LexicalEvidenceStrength = "none";
  for (const form of tokenMatchForms(lexicon, expected)) {
    const strength = lexicalEvidenceStrengthSingle(form, spoken);
    if (strength === "exact") return "exact";
    if (strength === "typo") best = "typo";
  }
  return best;
}

/**
 * Hard lexical equivalence — the only lexical evidence strong enough to
 * authorize a tier-1 `GATE_MATCH` or to serve as an independent anchor.
 */
export function hardLexicalEvidenceMatch(
  expected: string,
  spoken: string,
  lexicon?: VoiceMatchLexicon,
): boolean {
  return lexicalEvidenceStrength(expected, spoken, lexicon) === "exact";
}

/**
 * Any lexical evidence, including one-edit spelling tolerance.
 * For soft consumers (alignment pairing, scoring) whose results are still
 * subject to the pronunciation gate.
 */
export function lexicalEvidenceMatch(
  expected: string,
  spoken: string,
  lexicon?: VoiceMatchLexicon,
): boolean {
  return lexicalEvidenceStrength(expected, spoken, lexicon) !== "none";
}
