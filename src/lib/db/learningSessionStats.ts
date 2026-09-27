import type { UserId } from "@/types/schema";
import {
  alignLearningStreakWithActivity,
  getStreakForUser,
} from "@/lib/db/learningStreak";
import { fetchDailyXpForDayKey } from "@/lib/db/queries/dailyUserStats";
import { getUserById } from "@/lib/db/queries/users";
import { localDateKey } from "@/lib/db/localDateKey";
import { getGamificationProgress } from "@/lib/gamification/xp";
import { fetchUserGamification } from "@/lib/db/userGamificationRow";

export type LearningSessionStats = {
  streakCurrent: number;
  dailyXp: number;
  totalXp: number;
  totalLearningTimeMs: number;
  level?: number;
  lastClipXp?: number | null;
};

const GUEST_STATS: LearningSessionStats = {
  streakCurrent: 0,
  dailyXp: 0,
  totalXp: 0,
  totalLearningTimeMs: 0,
  level: 1,
  lastClipXp: null,
};

export async function getLearningSessionStats(
  userId: UserId | null | undefined,
): Promise<LearningSessionStats> {
  if (!userId) return GUEST_STATS;

  await alignLearningStreakWithActivity(userId);
  const dayKey = localDateKey();
  const [streak, dailyXp, gamification, user] = await Promise.all([
    getStreakForUser(userId),
    fetchDailyXpForDayKey(userId, dayKey),
    fetchUserGamification(userId),
    getUserById(userId),
  ]);
  const xpProgress = getGamificationProgress(gamification.totalXp);

  return {
    streakCurrent: streak.current,
    dailyXp,
    totalXp: xpProgress.totalXp,
    totalLearningTimeMs: user?.totalLearningTimeMs ?? 0,
    level: xpProgress.level,
    lastClipXp: null,
  };
}
