import { CONTRACTIONS } from "../../../../lenra-content-pipeline/src/difficulty/constants";
import { isExcludedCoreVocabularyForm } from "@/lib/dictionary/vocabularyCorePolicy";

function normalizeLookupForm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z']/g, "");
}

export function isDictionaryLookupExcludedForm(
  surface: string,
  lemma?: string,
): boolean {
  if (isExcludedCoreVocabularyForm(surface, lemma)) {
    return true;
  }
  const surfaceNorm = normalizeLookupForm(surface);
  const lemmaNorm = normalizeLookupForm(lemma ?? "");
  for (const form of [surfaceNorm, lemmaNorm]) {
    if (form && CONTRACTIONS.has(form)) {
      return true;
    }
  }
  return false;
}
