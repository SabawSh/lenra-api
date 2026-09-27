import { normalizeText, normalizeSpeechToken } from "@/helper/speech/normalizer";
import { tokenize } from "@/helper/speech/tokenizer";

export type TokenObservationPair = {
  expectedToken: string;
  observedToken: string;
};

/**
 * Analytics-only extraction of positional token mismatches between an expected
 * tile phrase and an observed transcript. Not used by the voice matcher.
 */
export function extractTokenObservationPairs(
  expectedTileText: string,
  observedTranscript: string,
): TokenObservationPair[] {
  const expectedTokens = tokenize(normalizeText(expectedTileText))
    .map((token) => normalizeSpeechToken(token))
    .filter(Boolean);
  const observedTokens = tokenize(normalizeText(observedTranscript))
    .map((token) => normalizeSpeechToken(token))
    .filter(Boolean);

  if (expectedTokens.length === 0 || observedTokens.length === 0) {
    return [];
  }

  const pairs: TokenObservationPair[] = [];

  for (
    let start = 0;
    start <= observedTokens.length - expectedTokens.length;
    start++
  ) {
    const window = observedTokens.slice(start, start + expectedTokens.length);
    for (let index = 0; index < expectedTokens.length; index++) {
      const expectedToken = expectedTokens[index]!;
      const observedToken = window[index]!;
      if (expectedToken === observedToken) continue;
      pairs.push({ expectedToken, observedToken });
    }
  }

  return pairs;
}
