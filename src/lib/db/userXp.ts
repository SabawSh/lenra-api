import { localDateKey } from "@/lib/db/learningStreak";
import { fetchDailyXpForDayKey } from "@/lib/db/queries/dailyUserStats";
import { fetchUserGamification } from "@/lib/db/userGamificationRow";
import { getGamificationProgress } from "@/lib/gamification/xp";
import { cache } from "react";

import type { UserId } from "@/types/schema";
export type UserXpSummary = {
  dailyXp: number;
  totalXp: number;
  level: number;
  progressPercent: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  xpRemainingToNextLevel: number;
};

export async function getTodayXp(userId: UserId): Promise<number> {
  const dayKey = localDateKey();
  return fetchDailyXpForDayKey(userId, dayKey);
}

export const getUserXpSummary = cache(async function getUserXpSummaryFn(
  userId: UserId,
): Promise<UserXpSummary> {
  const dayKey = localDateKey();

  const [gamification, dailyXp] = await Promise.all([
    fetchUserGamification(userId),
    fetchDailyXpForDayKey(userId, dayKey),
  ]);

  const progress = getGamificationProgress(gamification.totalXp);

  return {
    dailyXp,
    totalXp: progress.totalXp,
    level: progress.level,
    progressPercent: progress.progressPercent,
    xpIntoLevel: progress.xpIntoLevel,
    xpForNextLevel: progress.xpForNextLevel,
    xpRemainingToNextLevel: progress.xpRemainingToNextLevel,
  };
});

/** @deprecated Prefer `awardXp` from `lib/gamification/xp`. Kept for legacy call sites. */
export async function recordXpEarned(
  userId: UserId,
  xp: number,
): Promise<UserXpSummary> {
  const { awardXp } = await import("@/lib/gamification/awardXp");
  if (!Number.isFinite(xp) || xp <= 0) {
    return getUserXpSummary(userId);
  }
  await awardXp({
    userId,
    amount: Math.round(xp),
    reason: "complete_clip",
  });
  return getUserXpSummary(userId);
}
