import { getTokenDifficultyWeight } from "@/lib/performance/difficulty/getTokenDifficultyWeight";
import type { PerformanceChallenge } from "@/lib/performance/difficulty/types";

const MISTAKE_CAP = 14;
const HINT_CAP = 10;

function avgChunkDifficulty(challenge?: PerformanceChallenge): number {
  const chunks = challenge?.chunks ?? [];
  if (chunks.length === 0) {
    return getTokenDifficultyWeight({
      text: "word",
      clipDifficulty: challenge?.clipDifficulty,
    });
  }
  const sum = chunks.reduce(
    (acc, c) =>
      acc +
      getTokenDifficultyWeight({
        text: c.text,
        locked: c.locked,
        tokenCount: c.tokens.length || undefined,
        clipDifficulty: challenge?.clipDifficulty,
      }),
    0,
  );
  return sum / chunks.length;
}

/**
 * Softer, length-aware penalties — one mistake on a short clip should not crater the score.
 * Easier tiles cost slightly more per wrong move (careless on "the" vs struggling on jargon).
 */
export function computeMistakePenalty(params: {
  wrongMoves: number;
  attemptedWords: number;
  challenge?: PerformanceChallenge;
}): number {
  const { wrongMoves, attemptedWords, challenge } = params;
  if (wrongMoves <= 0) return 0;

  const avgWeight = avgChunkDifficulty(challenge);
  const refWeight = 1;
  // Easier average tile → slightly higher penalty per slip; hard tiles → gentler.
  const difficultyFactor = Math.max(0.75, Math.min(1.2, refWeight / avgWeight));

  const lengthScale = Math.sqrt(Math.max(3, attemptedWords));
  const scaled = Math.sqrt(wrongMoves) * difficultyFactor * (10 / lengthScale);
  const linear = wrongMoves * 1.35;

  return Math.min(MISTAKE_CAP, scaled + linear);
}

export function computeHintPenalty(params: {
  hintsUsed: number;
  attemptedWords: number;
}): number {
  const { hintsUsed, attemptedWords } = params;
  if (hintsUsed <= 0) return 0;

  const lengthScale = Math.sqrt(Math.max(3, attemptedWords));
  const scaled = Math.sqrt(hintsUsed) * (6 / lengthScale);

  return Math.min(HINT_CAP, scaled);
}
