import { localDateKey } from "@/lib/db/localDateKey";
import { assertUserId } from "@/lib/db/userId";
import {
  findUserStreakSliceById,
  updateUserLearningStreak,
} from "@/lib/db/queries/users";
import type { UserId } from "@/types/schema";
import { cache } from "react";

export { localDateKey } from "@/lib/db/localDateKey";

/** Streak breaks if no qualifying study within this window. */
export const STREAK_WINDOW_MS = 24 * 60 * 60 * 1000;

function localTodayBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start, end };
}

/** End of the local calendar day for a YYYY-MM-DD key (legacy rows without `last_learning_streak_at`). */
function endOfDayKey(key: string): Date {
  const [yy, mm, dd] = key.split("-").map(Number);
  return new Date(yy, mm - 1, dd, 23, 59, 59, 999);
}

type StreakRow = {
  lastLearningStreakDayKey: string | null;
  lastLearningStreakAt: Date | null;
  learningStreakCurrent: number;
  learningStreakBest: number;
};

function effectiveLastStreakAt(row: StreakRow): Date | null {
  if (row.lastLearningStreakAt) return row.lastLearningStreakAt;
  if (row.lastLearningStreakDayKey) {
    return endOfDayKey(row.lastLearningStreakDayKey);
  }
  return null;
}

function msSinceLastStreakActivity(row: StreakRow, now = new Date()): number {
  const lastAt = effectiveLastStreakAt(row);
  if (!lastAt) return Number.POSITIVE_INFINITY;
  return now.getTime() - lastAt.getTime();
}

function isStreakExpired(row: StreakRow, now = new Date()): boolean {
  if (row.learningStreakCurrent <= 0) return false;
  return msSinceLastStreakActivity(row, now) >= STREAK_WINDOW_MS;
}

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
 * Zero out the streak when the user has not studied within the last 24 hours.
 * Called on read paths so the UI reflects a broken chain without waiting for the next session.
 */
export async function expireLearningStreakIfNeeded(
  userId: UserId,
): Promise<void> {
  try {
    assertUserId(userId);

    const row = await fetchStreakRow(userId);
    if (!row || !isStreakExpired(row)) return;

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
 * At most one streak step per local calendar day while the chain is alive.
 * Missing 24 hours of study resets the chain; the next session starts at 1.
 */
export async function recordLearningActivityDay(userId: UserId): Promise<void> {
  try {
    assertUserId(userId);

    const now = new Date();
    const todayKey = localDateKey(now);

    await expireLearningStreakIfNeeded(userId);

    const user = await fetchStreakRow(userId);
    if (!user) return;

    const withinWindow = msSinceLastStreakActivity(user, now) < STREAK_WINDOW_MS;

    if (
      withinWindow &&
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

    let next = 1;
    if (!user.lastLearningStreakDayKey || user.learningStreakCurrent <= 0) {
      next = 1;
    } else if (withinWindow && user.lastLearningStreakDayKey !== todayKey) {
      next = user.learningStreakCurrent + 1;
    } else {
      next = 1;
    }

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
