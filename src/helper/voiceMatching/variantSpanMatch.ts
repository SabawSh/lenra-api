import englishNormalizationVariants from "@/helper/speech/data/englishNormalizationVariants.json";
import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";

/** Hard cap on joined tokens for variant span matching. */
export const MAX_VARIANT_SPAN = 3;

export type VariantSpanMatch = {
  /** How many expected tokens to consume (1..MAX_VARIANT_SPAN). */
  readonly expectedLen: number;
  /** How many spoken tokens to consume (1..MAX_VARIANT_SPAN). */
  readonly spokenLen: number;
};

type VariantDataset = {
  readonly variants: Readonly<Record<string, readonly string[]>>;
};

const dataset = englishNormalizationVariants as VariantDataset;

/**
 * Span-side normalization only: case / punct / spacing.
 * Must NOT apply speech colloquial expansions (gonna → going to).
 * Variant membership comes solely from the VariantFormProvider dataset.
 */
export function lightNormForVariantSpan(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/—/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

let spanVariantIndex: ReadonlyMap<string, readonly string[]> | null = null;

/**
 * Bidirectional variant classes from the same english.glm-derived JSON as
 * VariantFormProvider, keyed with {@link lightNormForVariantSpan} so colloquial
 * expansions are not applied during span lookup.
 */
export function getSpanVariantIndex(): ReadonlyMap<string, readonly string[]> {
  if (spanVariantIndex) return spanVariantIndex;

  const index = new Map<string, readonly string[]>();
  for (const [rawKey, rawForms] of Object.entries(dataset.variants)) {
    const key = lightNormForVariantSpan(rawKey);
    if (!key) continue;

    const forms = new Set<string>();
    for (const form of rawForms) {
      const normalized = lightNormForVariantSpan(form);
      if (normalized) forms.add(normalized);
    }
    const existing = index.get(key);
    if (existing) {
      for (const form of existing) forms.add(form);
    }
    if (forms.size > 0) {
      index.set(
        key,
        [...forms].sort((left, right) => left.localeCompare(right)),
      );
    }
  }

  spanVariantIndex = index;
  return spanVariantIndex;
}

/** Test-only. */
export function clearSpanVariantIndexForTests(): void {
  spanVariantIndex = null;
}

function joinSpan(
  tokens: readonly string[],
  start: number,
  length: number,
): string {
  const parts: string[] = [];
  for (let index = 0; index < length; index++) {
    const token = lightNormForVariantSpan(tokens[start + index] ?? "");
    if (!token) return "";
    // Reject tokens that themselves contain spaces after light-norm — those
    // already expanded somehow and must not be re-joined into false spans.
    if (token.includes(" ")) return "";
    parts.push(token);
  }
  return parts.join(" ");
}

/**
 * True only when both sides are distinct members of the same registered
 * variant class. Exact string equality is NOT a variant span (exact path owns that).
 */
export function variantFormsEquivalent(
  left: string,
  right: string,
  _lexicon?: VoiceMatchLexicon,
): boolean {
  const a = lightNormForVariantSpan(left);
  const b = lightNormForVariantSpan(right);
  if (!a || !b || a === b) return false;

  const index = getSpanVariantIndex();
  const classA = index.get(a);
  if (!classA) return false;
  return classA.some((form) => lightNormForVariantSpan(form) === b);
}

/**
 * Bounded N↔M variant span match (max 3 tokens per side).
 * Skips pure 1↔1. Prefers the smallest matching span (minimal consumption).
 * Equality uses only the VariantFormProvider dataset (no speech expansions).
 */
export function findVariantSpan(
  expectedTokens: readonly string[],
  expectedStart: number,
  spokenTokens: readonly string[],
  spokenStart: number,
  lexicon?: VoiceMatchLexicon,
): VariantSpanMatch | null {
  if (
    expectedStart >= expectedTokens.length ||
    spokenStart >= spokenTokens.length
  ) {
    return null;
  }

  const maxExpected = Math.min(
    MAX_VARIANT_SPAN,
    expectedTokens.length - expectedStart,
  );
  const maxSpoken = Math.min(MAX_VARIANT_SPAN, spokenTokens.length - spokenStart);

  // Smallest spans first so we never greedily swallow trailing tokens.
  for (let expectedLen = 1; expectedLen <= maxExpected; expectedLen++) {
    for (let spokenLen = 1; spokenLen <= maxSpoken; spokenLen++) {
      if (expectedLen === 1 && spokenLen === 1) continue;

      const expectedJoined = joinSpan(
        expectedTokens,
        expectedStart,
        expectedLen,
      );
      const spokenJoined = joinSpan(spokenTokens, spokenStart, spokenLen);
      if (!expectedJoined || !spokenJoined) continue;

      if (variantFormsEquivalent(expectedJoined, spokenJoined, lexicon)) {
        return { expectedLen, spokenLen };
      }
    }
  }

  return null;
}
