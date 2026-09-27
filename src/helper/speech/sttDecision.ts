import { matchVoiceTiles } from "@/helper/voiceMatching/matchVoiceTiles";
import type { ConsumedSpan, VoiceTile } from "@/helper/voiceMatching/types";
import { normalizeText } from "@/helper/speech/normalizer";
import { tokenize } from "@/helper/speech/tokenizer";
import { resolveSttFallbackConfig, type SttFallbackConfig } from "./sttConfig";

export type SttRetryReason =
  | "low_confidence"
  | "empty_transcript"
  | "zero_matcher_accepts";

export type ShouldRetryWithDeepgramInput = {
  transcript: string;
  confidence?: number;
  isFinal: boolean;
  expectedTiles: readonly VoiceTile[];
  transcriptTokens?: readonly string[];
  consumedSpans?: readonly ConsumedSpan[];
  config?: Partial<SttFallbackConfig>;
};

export type ShouldRetryWithDeepgramResult = {
  retry: boolean;
  reason: SttRetryReason | null;
};

function tokensForMatcher(
  transcript: string,
  transcriptTokens?: readonly string[],
): string[] {
  if (transcriptTokens && transcriptTokens.length > 0) {
    return [...transcriptTokens];
  }
  return tokenize(normalizeText(transcript));
}

/**
 * Decide whether Web Speech output should be retried with Deepgram.
 * Does not call Deepgram and does not mutate matcher state.
 */
export function shouldRetryWithDeepgram(
  input: ShouldRetryWithDeepgramInput,
): ShouldRetryWithDeepgramResult {
  const config = resolveSttFallbackConfig(input.config);

  if (!config.fallbackEnabled) {
    return { retry: false, reason: null };
  }

  if (!input.isFinal) {
    return { retry: false, reason: null };
  }

  const transcript = input.transcript.trim();
  if (!transcript) {
    return { retry: true, reason: "empty_transcript" };
  }

  if (
    input.confidence !== undefined &&
    input.confidence < config.retryConfidence
  ) {
    return { retry: true, reason: "low_confidence" };
  }

  if (input.expectedTiles.length > 0) {
    const tokens = tokensForMatcher(transcript, input.transcriptTokens);
    if (tokens.length === 0) {
      return { retry: true, reason: "empty_transcript" };
    }

    const matcherResult = matchVoiceTiles({
      transcript: tokens,
      unsolvedTiles: input.expectedTiles,
      consumedSpans: input.consumedSpans,
    });

    if (matcherResult.acceptedTiles.length === 0) {
      return { retry: true, reason: "zero_matcher_accepts" };
    }
  }

  return { retry: false, reason: null };
}
