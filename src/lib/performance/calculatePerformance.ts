import { computeAdaptiveSpeed } from "@/lib/performance/difficulty/adaptiveSpeed";
import {
  ATTEMPT_COST,
  MIN_COVERAGE_FOR_FULL_SCORE,
  PRONUNCIATION_CREDIT,
  SCORE_WEIGHTS,
  TIME_CREDIT,
} from "@/lib/performance/difficulty/constants";
import { computeSentenceDifficulty } from "@/lib/performance/difficulty/sentenceDifficulty";
import { computeWeightedAccuracy } from "@/lib/performance/difficulty/weightedAccuracy";
import { PerformanceRaw, PerformanceResult } from "@/types/learning";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Linear ramp: 0 at/below `zero`, 1 at/above `full`. */
function ramp(value: number, zero: number, full: number): number {
  return clamp01((value - zero) / (full - zero));
}

function finiteCount(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * Clip score from what actually happened in the attempt — see SCORE_WEIGHTS.
 * Shared verbatim by the app (instant modal) and lenra-api (persisted score).
 */
export function calculatePerformance(raw: PerformanceRaw): PerformanceResult {
  const challenge = raw.challenge;
  const isVoice = raw.inputMode === "voice";

  const accuracy = computeWeightedAccuracy({
    correctWords: raw.correctWords,
    attemptedWords: raw.attemptedWords,
    challenge,
  });

  const coverage =
    raw.totalWords === 0
      ? 0
      : Math.min(1, raw.attemptedWords / Math.max(1, raw.totalWords));

  // Learner time only: drop mic permission / speech-engine start-up.
  const totalMs = Math.max(0, raw.finishedAt - raw.startedAt);
  const engineWaitMs = Math.min(
    totalMs,
    Math.max(0, Number(raw.engineWaitMs) || 0),
  );
  const durationSec = Math.max(1, (totalMs - engineWaitMs) / 1000);

  const thinkMs =
    raw.thinkMs != null && Number.isFinite(raw.thinkMs)
      ? Math.max(0, Math.min(totalMs, raw.thinkMs))
      : null;

  const { index: sentenceDifficultyIndex } = computeSentenceDifficulty(
    challenge,
    raw.attemptedWords,
  );

  // 0–1: expected time for this line ÷ learner time (1 = on pace or faster).
  const speed = computeAdaptiveSpeed({
    durationSec,
    attemptedWords: raw.attemptedWords,
    sentenceDifficultyIndex,
    videoDurationMs: raw.videoDurationMs,
    inputMode: raw.inputMode,
    challenge,
  });

  // Kept for stored-progress XP replay; no longer part of the score.
  const modeBonus = isVoice ? 1 : 0.97;

  // Pronunciation = how closely the recognised words matched the line, blended
  // with the engine's own acoustic confidence when it reports one. Engines snap
  // to real words, so the word match alone is generous; confidence is what
  // drops when speech is unclear.
  const wordMatch =
    isVoice &&
    raw.pronunciationMatch != null &&
    Number.isFinite(raw.pronunciationMatch)
      ? clamp01(raw.pronunciationMatch)
      : null;
  const speechConfidence =
    isVoice &&
    raw.speechConfidence != null &&
    Number.isFinite(raw.speechConfidence) &&
    raw.speechConfidence > 0
      ? clamp01(raw.speechConfidence)
      : null;
  const blendedPronunciation =
    wordMatch != null && speechConfidence != null
      ? (wordMatch + speechConfidence) / 2
      : (wordMatch ?? speechConfidence);
  // Shown to the learner only with engine confidence: word match alone (e.g.
  // Safari) is ~100% for almost any recognisable speech, so it says little.
  const pronunciation = speechConfidence != null ? blendedPronunciation : null;

  const speakingRetries = isVoice ? finiteCount(raw.speakingRetries) : 0;
  const speakingAbandons = isVoice ? finiteCount(raw.speakingAbandons) : 0;
  const wrongMoves = finiteCount(raw.wrongMoves);
  const hintsUsed = finiteCount(raw.hintsUsed);

  const correctnessCredit = accuracy;
  // Legacy clients without a pronunciation signal: fall back to correctness.
  const pronunciationCredit =
    blendedPronunciation != null
      ? ramp(
          blendedPronunciation,
          PRONUNCIATION_CREDIT.zero,
          PRONUNCIATION_CREDIT.full,
        )
      : correctnessCredit;
  const attemptsCredit = clamp01(
    1 -
      wrongMoves * ATTEMPT_COST.wrongMove -
      hintsUsed * ATTEMPT_COST.hint -
      speakingRetries * ATTEMPT_COST.speakingRetry -
      speakingAbandons * ATTEMPT_COST.speakingAbandon,
  );
  const timeCredit = ramp(speed, TIME_CREDIT.zero, TIME_CREDIT.full);

  const w = isVoice ? SCORE_WEIGHTS.voice : SCORE_WEIGHTS.drag;

  // Zero accuracy must never produce a non-zero clip score.
  let score = 0;
  if (accuracy > 0) {
    score =
      correctnessCredit * w.correctness +
      pronunciationCredit * w.pronunciation +
      attemptsCredit * w.attempts +
      timeCredit * w.time;

    // Gentle coverage impact so a partial build can't look complete.
    if (coverage < MIN_COVERAGE_FOR_FULL_SCORE) {
      const coverageRatio = coverage / MIN_COVERAGE_FOR_FULL_SCORE;
      score *= 0.85 + clamp01(coverageRatio) * 0.15;
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
  }

  // Only voice can be a “perfect run” (full score ceiling + max XP).
  const isPerfectRun =
    isVoice &&
    score === 100 &&
    wrongMoves === 0 &&
    hintsUsed === 0 &&
    raw.attemptedWords > 0 &&
    raw.correctWords >= raw.attemptedWords;

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
    wrongMoves,
    hintsUsed,
    pronunciation,
    thinkSec: thinkMs != null ? thinkMs / 1000 : null,
    failedAttempts: speakingRetries + speakingAbandons,
    credits: {
      correctness: correctnessCredit,
      pronunciation: isVoice ? pronunciationCredit : null,
      attempts: attemptsCredit,
      time: timeCredit,
    },
  };
}
