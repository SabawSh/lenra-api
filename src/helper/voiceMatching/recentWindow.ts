import { DEFAULT_MAX_RECENT_TOKENS } from "./voiceMatchingConfig";
import type { RecentSpeechSlice } from "./types";

export function getRecentSpeechTokens(
  transcriptTokens: readonly string[],
  maxTokens: number = DEFAULT_MAX_RECENT_TOKENS,
): RecentSpeechSlice {
  const fullTokenCount = transcriptTokens.length;
  if (fullTokenCount === 0) {
    return { tokens: [], startOffset: 0, fullTokenCount: 0 };
  }

  const recentTokenCount = Math.min(maxTokens, fullTokenCount);
  const startOffset = fullTokenCount - recentTokenCount;

  return {
    tokens: transcriptTokens.slice(startOffset) as string[],
    startOffset,
    fullTokenCount,
  };
}
