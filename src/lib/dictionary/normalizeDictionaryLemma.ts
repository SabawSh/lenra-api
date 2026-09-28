import { lemmatizeWord } from "@/lib/dictionary/lemmatizeWord";

/** Matches `lookupDictionaryWord` surface normalization. */
export function normalizeDictionaryLookupSurface(word: string): string {
  return word
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
}

export function resolveDictionaryInventoryLemma(
  surface: string,
  tokenLemma?: string | null,
): string | null {
  const surfaceNorm = normalizeDictionaryLookupSurface(surface);
  const lemmaSource = (tokenLemma?.trim() || surfaceNorm).trim();
  if (!lemmaSource) {
    return null;
  }
  const normalizedLemmaSource = normalizeDictionaryLookupSurface(lemmaSource);
  if (!normalizedLemmaSource) {
    return null;
  }
  return lemmatizeWord(normalizedLemmaSource);
}
