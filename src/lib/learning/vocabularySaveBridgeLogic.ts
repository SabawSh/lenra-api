/**
 * Pure helpers for dictionary ↔ contextual saved-card bridge.
 * Safe to import from client / validation (no DB).
 */

export function normalizeSavedVocabularyWord(
  word: string | null | undefined,
): string {
  if (typeof word !== "string") return "";
  return word
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "")
    .trim();
}

/**
 * Decide whether a dictionary save should also write a contextual card.
 * Dictionary-only saves (no clip) remain valid.
 */
export function shouldWriteContextualSavedCard(
  clipId: string | null | undefined,
): boolean {
  return typeof clipId === "string" && clipId.trim().length > 0;
}

export function resolveContextualCardWords(params: {
  word?: string | null;
  lemma?: string | null;
}): { word: string; normalizedWord: string } | null {
  const surface =
    (typeof params.word === "string" && params.word.trim()) ||
    (typeof params.lemma === "string" && params.lemma.trim()) ||
    "";
  const normalizedWord = normalizeSavedVocabularyWord(surface);
  if (!normalizedWord) return null;
  return {
    word: surface.trim() || normalizedWord,
    normalizedWord,
  };
}
