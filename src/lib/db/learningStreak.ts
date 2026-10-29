import { localDateKey } from "@/lib/db/localDateKey";
import {
  isStreakExpiredByCalendar,
  nextStreakAfterActivity,
} from "@/lib/db/learningStreakCalendar";
import { assertUserId } from "@/lib/db/userId";
import {
  findUserStreakSliceById,
  updateUserLearningStreak,
} from "@/lib/db/queries/users";
import type { UserId } from "@/types/schema";
import { cache } from "react";

export { localDateKey } from "@/lib/db/localDateKey";
export {
  calendarDayOffset,
  isStreakExpiredByCalendar,
  nextStreakAfterActivity,
  parseDayKey,
} from "@/lib/db/learningStreakCalendar";

/**
 * @deprecated Kept for import compatibility. Streaks use calendar days, not a
 * rolling 24h clock — see {@link nextStreakAfterActivity}.
 */
export const STREAK_WINDOW_MS = 24 * 60 * 60 * 1000;

function localTodayBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start, end };
}

type StreakRow = {
  lastLearningStreakDayKey: string | null;
  lastLearningStreakAt: Date | null;
  learningStreakCurrent: number;
  learningStreakBest: number;
};

/** Any part practice logged today (local calendar), same window as streak day keys. */
export async function hasLearningActivityToday(
  userId: UserId,
): Promise<boolean> {
  assertUserId(userId);
  const { start, end } = localTodayBounds();
  const { countAttemptsInLocalWindow } = await import(
    "@/lib/db/queries/userPartProgress"
  );
  const n = await countAttemptsInLocalWindow(userId, start, end);
  return n > 0;
}

async function fetchStreakRow(userId: UserId): Promise<StreakRow | null> {
  return findUserStreakSliceById(userId);
}

async function writeStreakRow(
  userId: UserId,
  data: {
    lastLearningStreakDayKey: string | null;
    lastLearningStreakAt: Date | null;
    learningStreakCurrent: number;
    learningStreakBest: number;
  },
): Promise<void> {
  await updateUserLearningStreak(userId, {
    lastLearningStreakDayKey: data.lastLearningStreakDayKey,
    lastLearningStreakAt: data.lastLearningStreakAt,
    learningStreakCurrent: data.learningStreakCurrent,
    learningStreakBest: data.learningStreakBest,
  });
}

/**
 * Zero the streak when the user missed a full local calendar day.
 * Called on read paths so the UI reflects a broken chain without waiting for the next session.
 */
export async function expireLearningStreakIfNeeded(
  userId: UserId,
): Promise<void> {
  try {
    assertUserId(userId);

    const row = await fetchStreakRow(userId);
    if (!row || !isStreakExpiredByCalendar(row, localDateKey())) return;

    await writeStreakRow(userId, {
      lastLearningStreakDayKey: row.lastLearningStreakDayKey,
      lastLearningStreakAt: row.lastLearningStreakAt,
      learningStreakCurrent: 0,
      learningStreakBest: row.learningStreakBest,
    });
  } catch (e) {
    console.warn("[learningStreak] expireLearningStreakIfNeeded:", e);
  }
}

/**
 * Call when the user does real learning (watch time and/or part practice).
 * At most one streak step per local calendar day.
 * Missing a calendar day resets the chain; the next session starts at 1.
 */
export async function recordLearningActivityDay(userId: UserId): Promise<void> {
  try {
    assertUserId(userId);

    const now = new Date();
    const todayKey = localDateKey(now);

    await expireLearningStreakIfNeeded(userId);

    const user = await fetchStreakRow(userId);
    if (!user) return;

    if (
      user.lastLearningStreakDayKey === todayKey &&
      user.learningStreakCurrent > 0
    ) {
      await writeStreakRow(userId, {
        lastLearningStreakDayKey: todayKey,
        lastLearningStreakAt: now,
        learningStreakCurrent: user.learningStreakCurrent,
        learningStreakBest: user.learningStreakBest,
      });
      return;
    }

    const next = nextStreakAfterActivity({
      lastDayKey: user.lastLearningStreakDayKey,
      current: user.learningStreakCurrent,
      todayKey,
    });
    const best = Math.max(user.learningStreakBest, next);

    await writeStreakRow(userId, {
      lastLearningStreakDayKey: todayKey,
      lastLearningStreakAt: now,
      learningStreakCurrent: next,
      learningStreakBest: best,
    });
  } catch (e) {
    console.warn("[learningStreak] recordLearningActivityDay:", e);
  }
}

/**
 * If the user already practiced today but streak rows were never updated (e.g. legacy data
 * or a missed API call), apply the same rules as `recordLearningActivityDay` so “today”
 * shows at least 1 instead of staying at 0.
 */
export async function alignLearningStreakWithActivity(
  userId: UserId,
): Promise<void> {
  try {
    assertUserId(userId);

    await expireLearningStreakIfNeeded(userId);

    const row = await fetchStreakRow(userId);
    if (!row) return;

    if (row.lastLearningStreakDayKey === localDateKey()) return;

    if (!(await hasLearningActivityToday(userId))) return;

    await recordLearningActivityDay(userId);
  } catch (e) {
    console.warn("[learningStreak] alignLearningStreakWithActivity:", e);
  }
}

/** Read streak fields after expiry + alignment. Deduplicated per request via React.cache. */
export const getStreakForUser = cache(
  async (
    userId: UserId,
  ): Promise<{ current: number; best: number; lastDayKey: string | null }> => {
    try {
      assertUserId(userId);
      await expireLearningStreakIfNeeded(userId);
      const row = await fetchStreakRow(userId);
      if (!row) return { current: 0, best: 0, lastDayKey: null };
      return {
        current: Number(row.learningStreakCurrent),
        best: Number(row.learningStreakBest),
        lastDayKey: row.lastLearningStreakDayKey,
      };
    } catch {
      return { current: 0, best: 0, lastDayKey: null };
    }
  },
);
