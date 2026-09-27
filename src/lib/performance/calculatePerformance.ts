import { computeAdaptiveSpeed } from "@/lib/performance/difficulty/adaptiveSpeed";
import {
  MIN_COVERAGE_FOR_FULL_SCORE,
  SCORE_WEIGHTS,
} from "@/lib/performance/difficulty/constants";
import {
  computeHintPenalty,
  computeMistakePenalty,
} from "@/lib/performance/difficulty/mistakePenalty";
import {
  computeSentenceDifficulty,
} from "@/lib/performance/difficulty/sentenceDifficulty";
import { computeWeightedAccuracy } from "@/lib/performance/difficulty/weightedAccuracy";
import { PerformanceRaw, PerformanceResult } from "@/types/learning";

export function calculatePerformance(raw: PerformanceRaw): PerformanceResult {
  const challenge = raw.challenge;

  const accuracy = computeWeightedAccuracy({
    correctWords: raw.correctWords,
    attemptedWords: raw.attemptedWords,
    challenge,
  });

  const coverage =
    raw.totalWords === 0
      ? 0
      : Math.min(1, raw.attemptedWords / Math.max(1, raw.totalWords));

  const durationSec = Math.max(1, (raw.finishedAt - raw.startedAt) / 1000);

  const { index: sentenceDifficultyIndex } = computeSentenceDifficulty(
    challenge,
    raw.attemptedWords,
  );

  // Display/XP only — not used in clip score or skill calibration.
  const speed = computeAdaptiveSpeed({
    durationSec,
    attemptedWords: raw.attemptedWords,
    sentenceDifficultyIndex,
    videoDurationMs: raw.videoDurationMs,
    inputMode: raw.inputMode,
    challenge,
  });

  // Voice is harder in practice — reflected in time budget, not a post-score nerf.
  const modeBonus = raw.inputMode === "voice" ? 1 : 0.97;

  const mistakePenalty = computeMistakePenalty({
    wrongMoves: raw.wrongMoves,
    attemptedWords: raw.attemptedWords,
    challenge,
  });

  const hintPenalty = computeHintPenalty({
    hintsUsed: raw.hintsUsed,
    attemptedWords: raw.attemptedWords,
  });

  // Expose UI-facing rounded metrics so "looks perfect" can consistently mean
  // "scores/rewards as perfect" for voice practice.
  const displayedAccuracyIs100 = Math.round(accuracy * 100) === 100;

  const consistency = Math.max(
    0,
    1 - (mistakePenalty + hintPenalty) / (SCORE_WEIGHTS.accuracy * 0.6),
  );

  let baseScore =
    accuracy * SCORE_WEIGHTS.accuracy +
    consistency * SCORE_WEIGHTS.consistency +
    modeBonus * SCORE_WEIGHTS.inputExpectation;

  let score = baseScore;

  // Keep coverage impact, but make it gentle to avoid hidden punishment feeling.
  if (coverage < MIN_COVERAGE_FOR_FULL_SCORE) {
    const coverageRatio = coverage / MIN_COVERAGE_FOR_FULL_SCORE;
    const coverageFactor = 0.85 + Math.max(0, Math.min(1, coverageRatio)) * 0.15;
    score *= coverageFactor;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const voicePerfectByDisplayedMetrics =
    raw.inputMode === "voice" &&
    score >= 99 &&
    displayedAccuracyIs100 &&
    raw.wrongMoves === 0 &&
    raw.hintsUsed === 0;

  if (voicePerfectByDisplayedMetrics) {
    score = 100;
  }

  const flawlessOutcome =
    displayedAccuracyIs100 &&
    raw.wrongMoves === 0 &&
    raw.hintsUsed === 0 &&
    raw.correctWords >= raw.attemptedWords &&
    raw.attemptedWords > 0 &&
    score === 100;

  // Only voice can be a “perfect run” (full score ceiling + max XP).
  const isPerfectRun = raw.inputMode === "voice" && flawlessOutcome;

  let level: PerformanceResult["level"] = "weak";
  if (score >= 85) level = "excellent";
  else if (score >= 70) level = "good";
  else if (score >= 50) level = "ok";

  return {
    score,
    accuracy,
    coverage,
    durationSec,
    speed,
    modeBonus,
    level,
    inputMode: raw.inputMode,
    isPerfectRun,
    wrongMoves: raw.wrongMoves,
    hintsUsed: raw.hintsUsed,
  };
}
