import { normalizeSpeechToken } from "@/helper/speech/normalizer";

/** Cached expected token forms (CMUdict + token knowledge) keyed by normalized tile token. */
export type VoiceMatchLexicon = ReadonlyMap<string, readonly string[]>;

export function orthographicTokenForm(token: string): string {
  return normalizeSpeechToken(token);
}

/**
 * Lexical forms for a tile token. When no lexicon is supplied (unit tests /
 * legacy callers) only the orthographic form is used — matcher behavior matches
 * pre-surface matching.
 */
export function tokenMatchForms(
  lexicon: VoiceMatchLexicon | undefined,
  token: string,
): readonly string[] {
  const orthographic = orthographicTokenForm(token);
  if (!orthographic) return [];

  const cached = lexicon?.get(orthographic);
  if (cached && cached.length > 0) return cached;

  return [orthographic];
}

export function spokenMatchesCachedForm(
  lexicon: VoiceMatchLexicon | undefined,
  expectedToken: string,
  spokenToken: string,
): boolean {
  const spokenNorm = orthographicTokenForm(spokenToken);
  if (!spokenNorm) return false;

  return tokenMatchForms(lexicon, expectedToken).some(
    (form) => orthographicTokenForm(form) === spokenNorm,
  );
}
