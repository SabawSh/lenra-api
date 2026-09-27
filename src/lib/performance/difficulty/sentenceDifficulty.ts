import {
  CLIP_DIFFICULTY_FACTOR,
  REF_SENTENCE_DIFFICULTY,
} from "@/lib/performance/difficulty/constants";
import { getTokenDifficultyWeight } from "@/lib/performance/difficulty/getTokenDifficultyWeight";
import type {
  PerformanceChallenge,
  PerformanceChunkRef,
  TokenDifficultyInput,
} from "@/lib/performance/difficulty/types";
import type { PartDifficulty } from "@/types/video";

function countSurfaceFeatures(chunks: PerformanceChunkRef[]): {
  phrasalChunks: number;
  contractions: number;
} {
  let phrasalChunks = 0;
  let contractions = 0;
  for (const c of chunks) {
    const words = c.tokens.length || c.text.split(/\s+/).filter(Boolean).length;
    if (words >= 2) phrasalChunks += 1;
    if (/n't|'re|'ve|'ll|'d|'m\b|\b\w+'\w+/i.test(c.text)) contractions += 1;
  }
  return { phrasalChunks, contractions };
}

function sumChunkWeights(
  chunks: PerformanceChunkRef[],
  clipDifficulty?: PartDifficulty,
): number {
  return chunks.reduce(
    (sum, chunk) =>
      sum +
      getTokenDifficultyWeight({
        text: chunk.text,
        locked: chunk.locked,
        tokenCount: chunk.tokens.length || undefined,
        clipDifficulty,
      }),
    0,
  );
}

export type SentenceDifficultyBreakdown = {
  /** Raw sum of chunk/token weights. */
  tokenWeightSum: number;
  /** Normalized index used for speed + score calibration (~4–14 typical). */
  index: number;
  clipFactor: number;
  complexityBonus: number;
};

/**
 * Sentence difficulty from puzzle chunks + clip metadata.
 * Falls back to word-count estimate when chunks are missing.
 */
export function computeSentenceDifficulty(
  challenge: PerformanceChallenge | undefined,
  attemptedWords: number,
): SentenceDifficultyBreakdown {
  const clipDifficulty = challenge?.clipDifficulty ?? "medium";
  const clipFactor = CLIP_DIFFICULTY_FACTOR[clipDifficulty];

  const chunks = challenge?.chunks ?? [];
  let tokenWeightSum: number;

  if (chunks.length > 0) {
    tokenWeightSum = sumChunkWeights(chunks, clipDifficulty);
  } else {
    const perWord = getTokenDifficultyWeight({
      text: "placeholder",
      clipDifficulty,
    });
    tokenWeightSum = perWord * Math.max(1, attemptedWords);
  }

  const { phrasalChunks, contractions } =
    chunks.length > 0
      ? countSurfaceFeatures(chunks)
      : { phrasalChunks: 0, contractions: 0 };

  const scoreNorm = challenge?.difficultyScore;
  const scoreBoost =
    scoreNorm != null && Number.isFinite(scoreNorm)
      ? 0.92 + Math.min(1, scoreNorm / 100) * 0.14
      : 1;

  const speechRate = challenge?.speechRate;
  let speechFactor = 1;
  if (speechRate != null && Number.isFinite(speechRate)) {
    if (speechRate >= 1.25) speechFactor = 1.06;
    else if (speechRate <= 0.85) speechFactor = 0.96;
  }

  const complexityBonus =
    phrasalChunks * 0.35 + contractions * 0.25 + (clipFactor - 1) * 2;

  const index = Math.max(
    1,
    tokenWeightSum * scoreBoost * speechFactor + complexityBonus,
  );

  return {
    tokenWeightSum,
    index,
    clipFactor,
    complexityBonus,
  };
}

/** Maps sentence difficulty to a fair score multiplier (easy ↓, hard ↑). */
export function challengeFairnessMultiplier(sentenceIndex: number): number {
  const ratio = sentenceIndex / REF_SENTENCE_DIFFICULTY;
  return Math.max(0.88, Math.min(1.12, 0.94 + (ratio - 1) * 0.1));
}

/** Inputs for token weight when only aggregate counts exist (legacy raw). */
export function syntheticTokenInput(
  clipDifficulty?: PartDifficulty,
): TokenDifficultyInput {
  return { text: "word", clipDifficulty };
}
