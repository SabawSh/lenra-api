import {
  tokensToPhonemes,
  weightedPhoneticEditDistance,
} from "@/helper/speech/phoneticDistance";
import { normalizeToken, tokenizeTileText } from "./textUtils";
import type { SpeechWindow } from "./types";

export type PhraseSimilarityDiagnostics = {
  expectedPhrase: string;
  observedPhrase: string;
  expectedPhonemes: string[];
  observedPhonemes: string[];
};

export type PhraseSimilarityResult = {
  similarity: number;
  diagnostics: PhraseSimilarityDiagnostics;
  candidateWindow: SpeechWindow | null;
};

export type PhraseSimilarityCandidate = {
  window: SpeechWindow;
  similarity: number;
  diagnostics: PhraseSimilarityDiagnostics;
};

function phraseToPhonemes(phrase: string): string[] {
  const tokens = tokenizeTileText(phrase);
  return tokensToPhonemes(
    tokens
      .map((token) => normalizeToken(token))
      .filter((token) => token.length > 0),
  );
}

function observedPhraseFromTokens(tokens: readonly string[]): string {
  return tokens.join(" ");
}

/**
 * Score phonetic similarity between complete phrases (never token-by-token).
 * Pure scoring — no thresholds, config, or acceptance logic.
 */
export function scorePhraseSimilarity(
  expectedPhrase: string,
  observedPhrase: string,
  candidateWindow: SpeechWindow | null = null,
): PhraseSimilarityResult {
  const expectedPhonemes = phraseToPhonemes(expectedPhrase);
  const observedPhonemes = phraseToPhonemes(observedPhrase);

  const { similarity } = weightedPhoneticEditDistance(
    expectedPhonemes,
    observedPhonemes,
  );

  return {
    similarity,
    diagnostics: {
      expectedPhrase,
      observedPhrase,
      expectedPhonemes,
      observedPhonemes,
    },
    candidateWindow,
  };
}

export function scorePhraseSimilarityForWindow(
  expectedPhrase: string,
  window: SpeechWindow,
): PhraseSimilarityCandidate {
  const observedPhrase = observedPhraseFromTokens(window.tokens);
  const scored = scorePhraseSimilarity(expectedPhrase, observedPhrase, window);

  return {
    window,
    similarity: scored.similarity,
    diagnostics: scored.diagnostics,
  };
}

/** Track the highest-similarity window that can cover the full tile. */
export function collectPhraseSimilarityCandidate(input: {
  expectedPhrase: string;
  window: SpeechWindow;
  currentBest: PhraseSimilarityCandidate | null;
}): PhraseSimilarityCandidate {
  const tileTokenCount = tokenizeTileText(input.expectedPhrase).length;
  // Never promote a shorter suffix/prefix window (spoken "you" for "do you") —
  // those score high phonetically but steal standalone single-word tiles.
  if (input.window.tokens.length < tileTokenCount) {
    return input.currentBest;
  }

  const scored = scorePhraseSimilarityForWindow(
    input.expectedPhrase,
    input.window,
  );

  if (!input.currentBest || scored.similarity > input.currentBest.similarity) {
    return scored;
  }

  return input.currentBest;
}
