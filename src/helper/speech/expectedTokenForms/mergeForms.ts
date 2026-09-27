import { normalizeSpeechToken } from "@/helper/speech/normalizer";
import type {
  ExpectedTokenFormProvider,
  ExpectedTokenFormProviderContext,
} from "./types";

function normalizeKey(token: string): string {
  return normalizeSpeechToken(token);
}

/**
 * Deterministically merge provider forms for one token.
 * Orthographic form is always first when present; remaining forms are sorted.
 */
export function mergeExpectedTokenForms(
  providers: readonly ExpectedTokenFormProvider[],
  token: string,
  context: ExpectedTokenFormProviderContext,
): readonly string[] {
  const key = normalizeKey(token);
  if (!key || !context.closedVocabulary.has(key)) return [];

  const merged = new Set<string>();
  for (const provider of providers) {
    for (const form of provider.formsForToken(key, context)) {
      const normalized = normalizeKey(form);
      if (normalized) merged.add(normalized);
    }
  }

  if (merged.size === 0) return [];

  const forms = [...merged];
  forms.sort((left, right) => {
    if (left === key) return -1;
    if (right === key) return 1;
    return left.localeCompare(right);
  });

  return forms;
}

export function closedVocabularyFromTokens(
  tokens: Iterable<string>,
): ReadonlySet<string> {
  const vocabulary = new Set<string>();
  for (const token of tokens) {
    const key = normalizeKey(token);
    if (key) vocabulary.add(key);
  }
  return vocabulary;
}
