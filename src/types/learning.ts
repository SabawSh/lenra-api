import type { PerformanceChallenge } from "../lib/performance/difficulty/types.js";

export type {
  PerformanceChallenge,
  PerformanceChunkRef,
} from "../lib/performance/difficulty/types.js";

export type InputMode = "drag" | "voice";

export type PerformanceRaw = {
  unitId: string;

  totalWords: number;
  correctWords: number;
  attemptedWords: number;
  wrongMoves: number;
  hintsUsed: number;
  videoDurationMs: number;

  inputMode: InputMode;

  startedAt: number;
  finishedAt: number;

  attempts: number;

  /** Clip + puzzle context for difficulty-aware scoring (optional for legacy clients). */
  challenge?: PerformanceChallenge;
};

export type PerformanceResult = {
  score: number; // 0 - 100
  accuracy: number; // 0 - 1
  speed: number; // 0 - 1
  /** Fraction of puzzle chunks attempted (0 - 1). */
  coverage: number;
  modeBonus: number; // 0 - 1
  durationSec: number;
  level: PerformanceLevel;
  inputMode: InputMode;
  /** Flawless run: full accuracy/speed/coverage, zero mistakes and hints. */
  isPerfectRun: boolean;
  /** Wrong tile placements / order slips during the round. */
  wrongMoves: number;
  hintsUsed: number;
};

export type PerformanceLevel = "excellent" | "good" | "ok" | "weak";

export type ReminderLevel = "easy" | "normal" | "hard";

export type ReminderOption = {
  level: ReminderLevel;
  days: number;
  recommended: boolean;
};

export type { ReminderSchedulingContext } from "../lib/performance/reminder/types.js";
