import { PerformancePersistError } from "@/lib/services/performancePersistError";
import { calculatePerformance } from "@/lib/performance/calculatePerformance";
import type { UnlockedAchievementPayload } from "@/lib/achievements/engine";
import type { ClipXpAwardResult } from "@/lib/gamification/xp";
import type { PerformanceChallenge } from "@/types/learning";
import {
  InputMode,
  PerformanceLevel,
  PerformanceRaw,
  PerformanceResult,
  ReminderOption,
} from "@/types/learning";
import {
  buildReminderOptions,
  buildReminderOptionsForSession,
} from "../performance/reminderSchedualer";

export type BuildPerformanceParams = {
  partId: string;
  caption: string | null;
  /** Spoken content length — used as `videoDurationMs` in performance raw. */
  speechDurationMs: number;
  inputMode: InputMode;
  startedAt: number;
  finishedAt: number;
  attempts: number;
  wrongMoves: number;
  hintsUsed: number;
  correctWords: number;
  attemptedWords: number;
  /** Prefer puzzle chunk count from the client; caption split often mismatches attemptedWords */
  totalWords?: number;
  challenge?: PerformanceChallenge;
};

/** Sync: use for immediate UI (modal) before persisting to the server. */
export function computeCompletedPerformance({
  partId,
  caption,
  speechDurationMs,
  inputMode,
  startedAt,
  finishedAt,
  attempts,
  wrongMoves,
  hintsUsed,
  correctWords,
  attemptedWords,
  totalWords: totalWordsOverride,
  challenge,
  previousIntervalDays,
}: BuildPerformanceParams & {
  previousIntervalDays?: number | null;
}): {
  performance: PerformanceResult;
  reminderOptions: ReminderOption[];
  raw: PerformanceRaw;
} {
  const raw: PerformanceRaw = {
    unitId: partId,
    totalWords:
      totalWordsOverride ??
      challenge?.chunks?.length ??
      (caption ? caption.split(/\s+/).filter(Boolean).length : 0),
    correctWords,
    attemptedWords,
    videoDurationMs: speechDurationMs,
    wrongMoves,
    hintsUsed,
    inputMode,
    startedAt,
    finishedAt,
    attempts,
    challenge,
  };

  const performance = calculatePerformance(raw);
  return {
    performance,
    reminderOptions: buildReminderOptionsForSession(performance, raw, {
      previousIntervalDays,
    }),
    raw,
  };
}

export type PersistedPerformanceXp = {
  earned: number;
  dailyXp: number;
  totalXp: number;
  level: number;
  streakCurrent: number;
  gamification: ClipXpAwardResult | null;
  achievementsUnlocked?: UnlockedAchievementPayload[];
  achievementXpAwarded?: number;
};

export async function persistCompletedPerformance(
  partId: string,
  performance: PerformanceResult,
  raw: PerformanceRaw,
  opts?: {
    sectionEndReach?: boolean;
    skipped?: boolean;
    /** Earlier atomic clips in the same virtual learning unit (progress only). */
    companionPartIds?: string[];
    /** Learn session placement — saved as bookmark on completion. */
    sessionSectionIndex?: number;
    visibleUnitStep?: number;
    videoId?: string;
    seasonId?: string;
    episodeId?: string;
    /** When true, do not advance Continue Learning journey pointer. */
    reviewMode?: boolean;
  },
): Promise<PersistedPerformanceXp> {
  console.time("reminder-click-api-performance");
  try {
    const res = await fetch("/api/performance", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        partId,
        raw,
        sectionEndReach: opts?.sectionEndReach,
        skipped: opts?.skipped,
        companionPartIds: opts?.companionPartIds,
        sessionSectionIndex: opts?.sessionSectionIndex,
        visibleUnitStep: opts?.visibleUnitStep,
        videoId: opts?.videoId,
        seasonId: opts?.seasonId,
        episodeId: opts?.episodeId,
        reviewMode: opts?.reviewMode,
      }),
    });

    let data: {
      error?: string;
      xp?: PersistedPerformanceXp;
      achievementsUnlocked?: UnlockedAchievementPayload[];
      achievementXpAwarded?: number;
    } = {};

    try {
      data = (await res.json()) as typeof data;
    } catch {
      /* non-JSON error body */
    }

    if (!res.ok) {
      const code = typeof data.error === "string" ? data.error : undefined;
      const message =
        res.status === 401
          ? "Please sign in again to save progress."
          : code === "invalid_payload"
            ? "Invalid clip data — try practicing this part again."
            : code === "invalid_raw"
            ? "Could not score this attempt — try again."
            : code === "invalid_part"
              ? "This clip is no longer available — reload and try again."
              : `Could not save progress (${res.status}).`;
      throw new PerformancePersistError(message, res.status, code);
    }

    const xp = data.xp ?? null;
    if (!xp) {
      throw new PerformancePersistError(
        "Server did not return progress data.",
        res.status,
      );
    }

    if (data.achievementsUnlocked) {
      xp.achievementsUnlocked = data.achievementsUnlocked;
      xp.achievementXpAwarded = data.achievementXpAwarded;
    }
    return xp;
  } finally {
    console.timeEnd("reminder-click-api-performance");
  }
}

export const buildAndSaveCompletedPerformance = async (
  params: BuildPerformanceParams,
): Promise<{
  performance: PerformanceResult;
  reminderOptions: ReminderOption[];
}> => {
  const { performance, reminderOptions, raw } =
    computeCompletedPerformance(params);
  await persistCompletedPerformance(params.partId, performance, raw);
  return { performance, reminderOptions };
};

/** Raw payload for an explicit skip — yields score 0 on the server. */
export function buildSkippedPerformanceRaw(
  partId: string,
  speechDurationMs: number,
): PerformanceRaw {
  const now = Date.now();
  return {
    unitId: partId,
    totalWords: 1,
    correctWords: 0,
    attemptedWords: 0,
    wrongMoves: 0,
    hintsUsed: 0,
    videoDurationMs: speechDurationMs,
    inputMode: "drag",
    startedAt: now,
    finishedAt: now,
    attempts: 1,
  };
}

export async function persistSkippedPartPerformance(
  partId: string,
  speechDurationMs: number,
  opts?: {
    sectionEndReach?: boolean;
    sessionSectionIndex?: number;
    visibleUnitStep?: number;
    videoId?: string;
    seasonId?: string;
    episodeId?: string;
    reviewMode?: boolean;
  },
): Promise<PersistedPerformanceXp | null> {
  const { performance } = buildTimeoutPerformance();
  const raw = buildSkippedPerformanceRaw(partId, speechDurationMs);
  return persistCompletedPerformance(partId, performance, raw, {
    sectionEndReach: opts?.sectionEndReach,
    skipped: true,
    sessionSectionIndex: opts?.sessionSectionIndex,
    visibleUnitStep: opts?.visibleUnitStep,
    videoId: opts?.videoId,
    seasonId: opts?.seasonId,
    episodeId: opts?.episodeId,
    reviewMode: opts?.reviewMode,
  });
}

export const buildTimeoutPerformance = () => {
  const performance = {
    score: 0,
    speed: 0,
    coverage: 0,
    level: "weak" as PerformanceLevel,
    accuracy: 0,
    modeBonus: 0,
    durationSec: 0,
    inputMode: "drag" as const,
    isPerfectRun: false,
    wrongMoves: 0,
    hintsUsed: 0,
  };

  return {
    performance,
    reminderOptions: buildReminderOptions(performance),
  };
};
