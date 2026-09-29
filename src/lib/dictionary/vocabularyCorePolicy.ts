import { CORE_VOCABULARY } from "@/lib/dictionary/difficultyConstants";

/**
 * Repair rare AI lemma truncations where surface === lemma + "d" and lemma
 * does not end with "e" (so this is not a silent-e past like like→liked).
 *
 * Note: truncations such as need←nee end with "e" on the bad lemma; those are
 * handled by CORE surface exclusion (`isExcludedCoreVocabularyForm`) rather
 * than lemma rewriting.
 */
export function repairTruncatedVocabularyLemma(
  surface: string,
  lemma: string,
): string {
  const surfaceNorm = surface
    .trim()
    .toLowerCase()
    .replace(/[^a-z']/g, "");
  const lemmaNorm = lemma
    .trim()
    .toLowerCase()
    .replace(/[^a-z']/g, "");
  if (!surfaceNorm || !lemmaNorm) {
    return lemmaNorm || surfaceNorm;
  }
  if (surfaceNorm === lemmaNorm) {
    return lemmaNorm;
  }
  if (
    surfaceNorm === `${lemmaNorm}d` &&
    !lemmaNorm.endsWith("e") &&
    lemmaNorm.length >= 2
  ) {
    return surfaceNorm;
  }
  return lemmaNorm;
}

function normalizeCoreForm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z']/g, "");
}

/**
 * True when surface and/or lemma is high-frequency CORE vocabulary and should
 * not become learner-facing Vocabulary (precision-first policy).
 */
export function isExcludedCoreVocabularyForm(
  surface: string,
  lemma?: string,
): boolean {
  const surfaceNorm = normalizeCoreForm(surface);
  const lemmaNorm = normalizeCoreForm(lemma ?? "");
  const repaired = repairTruncatedVocabularyLemma(
    surfaceNorm || surface,
    lemmaNorm || surfaceNorm,
  );

  for (const form of [surfaceNorm, lemmaNorm, repaired]) {
    if (form && CORE_VOCABULARY.has(form)) {
      return true;
    }
  }
  return false;
}
