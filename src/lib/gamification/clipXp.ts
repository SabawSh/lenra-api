import type { PartDifficulty } from "@/types/video";

/** Highest XP a single clip can award (voice + hard + top score). */
export const CLIP_XP_MAX = 12;
export const CLIP_XP_MIN = 2;

/** Fallback estimates when score is unavailable (mid-range completion). */
export const CLIP_XP_DRAG = 4;
export const CLIP_XP_VOICE = 6;

export type ClipXpContext = {
  score?: number;
  clipDifficulty?: PartDifficulty;
  difficultyScore?: number | null;
  accuracy?: number;
  speed?: number;
  modeBonus?: number;
  wrongMoves?: number;
  hintsUsed?: number;
};

function baseXpFromScore(score: number): number {
  if (score <= 0) return 0;
  if (score < 50) return 2; // weak
  if (score < 70) return 4; // ok
  if (score < 85) return 7; // good
  return 10; // excellent
}

function toPercent(value01: number): number {
  return Math.round(Math.max(0, Math.min(1, value01)) * 100);
}

function rendersAs100(value01: number): boolean {
  return toPercent(value01) === 100;
}

/**
 * Mirrors the success modal's metric formulas so XP and UI stay aligned.
 * If users see all shown metrics at 100%, XP should treat that run as 100 score.
 */
function allDisplayedMetricsRender100(
  inputMode: "drag" | "voice",
  score: number,
  context?: ClipXpContext,
): boolean {
  const accuracy = context?.accuracy;
  const speed = context?.speed;
  const modeBonus = context?.modeBonus;

  if (
    typeof accuracy !== "number" ||
    typeof speed !== "number" ||
    typeof modeBonus !== "number"
  ) {
    return false;
  }

  if (inputMode === "drag") {
    const masteryMetric = score / 100;
    const recallMetric = Math.min(1, accuracy * 0.9 + masteryMetric * 0.1);
    const carefulMetric = Math.min(1, accuracy * 0.7 + masteryMetric * 0.3);
    return (
      rendersAs100(accuracy) &&
      rendersAs100(masteryMetric) &&
      rendersAs100(recallMetric) &&
      rendersAs100(carefulMetric)
    );
  }

  const recallMetric = Math.min(1, accuracy * 0.85 + speed * 0.15);
  const confidenceMetric = modeBonus * 0.55 + accuracy * 0.45;
  const timingMetric = Math.min(1, speed * 0.55 + accuracy * 0.45);
  return (
    rendersAs100(accuracy) &&
    rendersAs100(speed) &&
    rendersAs100(confidenceMetric) &&
    rendersAs100(recallMetric) &&
    rendersAs100(timingMetric)
  );
}

function normalizeScoreForXp(
  inputMode: "drag" | "voice",
  rawScore: number,
  context?: ClipXpContext,
): number {
  const clamped = Math.max(0, Math.min(100, rawScore));

  // Explicitly protect against floating-point mismatches near perfect runs.
  if (clamped >= 99.5) return 100;

  const rounded = Math.round(clamped);
  // Trust the exact UI surface: if every visible metric is rendered as 100%,
  // XP must treat the run as perfect to avoid "perfect UI, non-perfect reward".
  if (allDisplayedMetricsRender100(inputMode, rounded, context)) {
    return 100;
  }
  return rounded;
}

function isPerfectVoiceRun(
  inputMode: "drag" | "voice",
  score: number,
  context?: ClipXpContext,
): boolean {
  if (inputMode !== "voice" || score !== 100) return false;
  if (context?.wrongMoves !== 0 || context?.hintsUsed !== 0) return false;
  if (typeof context?.accuracy !== "number" || typeof context?.speed !== "number") {
    return false;
  }
  return rendersAs100(context.accuracy) && rendersAs100(context.speed);
}

function dragCleanlinessMultiplier(wrongMoves: number): number {
  if (wrongMoves <= 1) return 1;
  if (wrongMoves <= 3) return 0.92;
  if (wrongMoves <= 5) return 0.82;
  if (wrongMoves <= 8) return 0.7;
  if (wrongMoves <= 12) return 0.55;
  return 0.4;
}

/** Mirrors `calculatePerformance` mode weight for stored-progress XP replay. */
export function modeBonusForInputMode(
  inputMode?: "drag" | "voice" | null,
): number {
  return inputMode === "voice" ? 1 : 0.97;
}

/** Build clip XP context from persisted progress (section summary, dashboards). */
export function clipXpContextFromStoredProgress(params: {
  inputMode?: "drag" | "voice" | null;
  bestScore: number;
  wrongMoves?: number;
  accuracy?: number | null;
  speed?: number | null;
}): ClipXpContext {
  const ctx: ClipXpContext = {
    score: params.bestScore,
    wrongMoves: params.wrongMoves ?? 0,
    hintsUsed: 0,
    modeBonus: modeBonusForInputMode(params.inputMode),
  };
  if (params.accuracy != null) ctx.accuracy = params.accuracy;
  if (params.speed != null) ctx.speed = params.speed;
  return ctx;
}

/** XP from this clip's performance level. */
export function clipXpAmount(
  inputMode?: "drag" | "voice",
  context?: ClipXpContext,
): number {
  const rawScore =
    typeof context?.score === "number"
      ? context.score
      : null;

  const normalizedInputMode = inputMode === "voice" ? "voice" : "drag";

  if (rawScore == null) {
    return inputMode === "voice" ? CLIP_XP_VOICE : CLIP_XP_DRAG;
  }
  const score = normalizeScoreForXp(normalizedInputMode, rawScore, context);

  if (isPerfectVoiceRun(normalizedInputMode, score, context)) return CLIP_XP_MAX;

  const baseXp = baseXpFromScore(score);
  if (baseXp <= 0) return 0;

  if (normalizedInputMode === "drag") {
    const wrongMoves = Math.max(0, context?.wrongMoves ?? 0);
    const scaled = Math.round(baseXp * dragCleanlinessMultiplier(wrongMoves));
    return Math.max(1, Math.min(CLIP_XP_MAX, scaled));
  }

  return baseXp;
}

/**
 * Success UI ceiling ("+X / 12"). Uses the platform max so voice and drag share
 * the same understandable cap; earned XP still respects per-mode score limits.
 */
export function maxClipXpAmount(
  _inputMode?: "drag" | "voice",
  _context?: Omit<ClipXpContext, "score">,
): number {
  return CLIP_XP_MAX;
}

/** True best-case XP for a mode (e.g. estimates). */
export function bestCaseClipXpAmount(
  inputMode?: "drag" | "voice",
  context?: Omit<ClipXpContext, "score">,
): number {
  return clipXpAmount(inputMode, {
    score: 100,
    clipDifficulty: context?.clipDifficulty ?? "hard",
    difficultyScore: context?.difficultyScore ?? 1,
  });
}
