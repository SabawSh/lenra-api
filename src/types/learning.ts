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

  /**
   * Voice only: mean 0–1 closeness of what the speech engine heard to the
   * expected words, over accepted tiles (1 = exact). Null/absent → not measured.
   */
  pronunciationMatch?: number | null;
  /**
   * Voice only: mean acoustic confidence the speech engine reported for its
   * final results (0–1). Null when the engine doesn't report one (e.g. Safari).
   */
  speechConfidence?: number | null;
  /** Voice holds where speech was heard but no word was accepted. */
  speakingRetries?: number;
  /** Voice holds released without any speech. */
  speakingAbandons?: number;
  /** Answer start → first mic press / tile tap (recall time). */
  thinkMs?: number | null;
  /** Mic permission / speech engine start-up time, excluded from timing. */
  engineWaitMs?: number;
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
  /** Voice: 0–1 pronunciation match (null when not measured / drag). */
  pronunciation?: number | null;
  /** Seconds from answer start to the first mic press / tile tap. */
  thinkSec?: number | null;
  /** Failed voice holds (heard but nothing accepted, or silent). */
  failedAttempts?: number;
  /** 0–1 credit per score part (what the score was actually built from). */
  credits?: {
    correctness: number;
    pronunciation: number | null;
    attempts: number;
    time: number;
  };
};

export type PerformanceLevel = "excellent" | "good" | "ok" | "weak";

export type ReminderLevel = "easy" | "normal" | "hard";

export type ReminderOption = {
  level: ReminderLevel;
  days: number;
  recommended: boolean;
};

export type { ReminderSchedulingContext } from "../lib/performance/reminder/types.js";
