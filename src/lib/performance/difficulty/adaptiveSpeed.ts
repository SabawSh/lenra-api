import type { PerformanceChallenge } from "@/lib/performance/difficulty/types";

const BASE_SEC = 4;
const PER_WORD_SEC = 0.55;
const PER_DIFFICULTY_SEC = 0.45;
const VOICE_TIME_FACTOR = 0.92;
const DRAG_TIME_FACTOR = 1;

/**
 * Harder sentences get more expected response time; speed is capped at 1.
 */
export function computeAdaptiveSpeed(params: {
  durationSec: number;
  attemptedWords: number;
  sentenceDifficultyIndex: number;
  videoDurationMs: number;
  inputMode: "drag" | "voice";
  challenge?: PerformanceChallenge;
}): number {
  const {
    durationSec,
    attemptedWords,
    sentenceDifficultyIndex,
    videoDurationMs,
    inputMode,
    challenge,
  } = params;

  const words = Math.max(1, attemptedWords);
  const clipSec = Math.max(1, videoDurationMs / 1000);

  let expectedSec =
    BASE_SEC +
    words * PER_WORD_SEC +
    sentenceDifficultyIndex * PER_DIFFICULTY_SEC;

  // Anchor to clip length so very short lines are not speed-raced.
  expectedSec = Math.max(expectedSec, clipSec * 1.6);

  const speechRate = challenge?.speechRate;
  if (speechRate != null && Number.isFinite(speechRate)) {
    if (speechRate >= 1.2) expectedSec *= 0.94;
    else if (speechRate <= 0.9) expectedSec *= 1.06;
  }

  const modeFactor =
    inputMode === "voice" ? VOICE_TIME_FACTOR : DRAG_TIME_FACTOR;
  expectedSec *= modeFactor;

  const safeDuration = Math.max(1, durationSec);
  return Math.min(1, expectedSec / safeDuration);
}
