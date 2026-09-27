import { getTokenDifficultyWeight } from "@/lib/performance/difficulty/getTokenDifficultyWeight";
import type {
  PerformanceChallenge,
  PerformanceChunkRef,
} from "@/lib/performance/difficulty/types";

function chunkWeight(
  chunk: PerformanceChunkRef,
  clipDifficulty: PerformanceChallenge["clipDifficulty"],
): number {
  return getTokenDifficultyWeight({
    text: chunk.text,
    locked: chunk.locked,
    tokenCount: chunk.tokens.length || undefined,
    clipDifficulty,
  });
}

/**
 * Difficulty-weighted accuracy: hard tiles count more than filler.
 * `correctWords` is the correct prefix length (existing puzzle semantics).
 */
export function computeWeightedAccuracy(params: {
  correctWords: number;
  attemptedWords: number;
  challenge?: PerformanceChallenge;
}): number {
  const { correctWords, attemptedWords, challenge } = params;
  if (attemptedWords <= 0) return 0;

  const chunks = challenge?.chunks ?? [];
  const clipDifficulty = challenge?.clipDifficulty;

  if (chunks.length === 0) {
    const simple = correctWords / attemptedWords;
    const clipBump =
      clipDifficulty === "hard"
        ? 1.04
        : clipDifficulty === "easy"
          ? 0.97
          : 1;
    return Math.min(1, simple * clipBump);
  }

  const attempted = Math.min(attemptedWords, chunks.length);
  const correct = Math.min(correctWords, attempted);

  let totalWeight = 0;
  let correctWeight = 0;

  for (let i = 0; i < attempted; i++) {
    const w = chunkWeight(chunks[i], clipDifficulty);
    totalWeight += w;
    if (i < correct) correctWeight += w;
  }

  if (totalWeight <= 0) return correctWords / attemptedWords;
  return Math.min(1, correctWeight / totalWeight);
}
