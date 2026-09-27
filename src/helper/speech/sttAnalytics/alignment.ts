import { tokenize } from "@/helper/speech/tokenizer";
import { normalizeText } from "@/helper/speech/normalizer";
import type { TokenAlignmentPair, TokenAlignmentRecord } from "./types";

/**
 * Analytics-only token alignment — not used by the voice matcher.
 * Greedy left-to-right pairing of expected tokens against observed tokens.
 */
export function buildAnalyticsTokenAlignment(
  expectedText: string,
  observedTranscript: string,
): TokenAlignmentRecord {
  const expectedTokens = tokenize(normalizeText(expectedText));
  const observedTokens = tokenize(normalizeText(observedTranscript));

  const alignedPairs: TokenAlignmentPair[] = [];
  const usedObserved = new Set<number>();

  for (let expectedIndex = 0; expectedIndex < expectedTokens.length; expectedIndex++) {
    const expected = expectedTokens[expectedIndex]!;
    for (let observedIndex = 0; observedIndex < observedTokens.length; observedIndex++) {
      if (usedObserved.has(observedIndex)) continue;
      const observed = observedTokens[observedIndex]!;
      if (expected.toLowerCase() !== observed.toLowerCase()) continue;

      alignedPairs.push({
        expected,
        observed,
        expectedIndex,
        observedIndex,
      });
      usedObserved.add(observedIndex);
      break;
    }
  }

  return {
    expectedTokens,
    observedTokens,
    alignedPairs,
  };
}
