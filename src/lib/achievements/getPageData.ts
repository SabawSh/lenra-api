import type { UserId } from "@/types/schema";

import {
  getUserAchievementsWithDefinitions,
  resolveAchievementStatus,
  syncUserAchievements,
} from "@/lib/achievements/engine";
import type {
  AchievementIconId,
  UserAchievementView,
} from "@/lib/achievements/types";
import type { AchievementRarity } from "@/lib/dashboard/tokens";
import { getUserXpSummary } from "@/lib/db/userXp";
import { alignLearningStreakWithActivity, getStreakForUser } from "@/lib/db/learningStreak";

const ICON_IDS = new Set<string>([
  "play",
  "film",
  "tv",
  "clapperboard",
  "mic",
  "volume2",
  "timer",
  "bookOpen",
  "bookMarked",
  "crown",
  "flame",
  "moon",
  "sun",
  "zap",
  "target",
  "sparkles",
  "theater",
  "laugh",
  "clock",
]);

function asIconId(icon: string): AchievementIconId {
  return (ICON_IDS.has(icon) ? icon : "play") as AchievementIconId;
}

function asRarity(rarity: string): AchievementRarity {
  if (
    rarity === "common" ||
    rarity === "rare" ||
    rarity === "epic" ||
    rarity === "legendary"
  ) {
    return rarity;
  }
  return "common";
}

export type AchievementsPageData = {
  level: number;
  totalXp: number;
  progressPercent: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  xpRemainingToNextLevel: number;
  streak: number;
  achievements: UserAchievementView[];
  unlockedCount: number;
  totalAchievements: number;
};

export async function getAchievementsPageData(
  userId: UserId,
  { skipSync = false }: { skipSync?: boolean } = {},
): Promise<AchievementsPageData> {
  const [xpSummary, streak, , rows] = await Promise.all([
    getUserXpSummary(userId),
    skipSync
      ? getStreakForUser(userId)
      : alignLearningStreakWithActivity(userId).then(() =>
          getStreakForUser(userId),
        ),
    skipSync ? Promise.resolve(null) : syncUserAchievements(userId),
    getUserAchievementsWithDefinitions(userId),
  ]);

  const achievements: UserAchievementView[] = rows.map((row) => {
    const progress = row.userProgress?.progress ?? 0;
    const completed = row.userProgress?.completed ?? false;
    return {
      id: row.key,
      iconId: asIconId(row.icon),
      category: row.category as UserAchievementView["category"],
      rarity: asRarity(row.rarity),
      xpReward: row.xpReward,
      target: row.targetValue,
      progress: completed ? row.targetValue : progress,
      status: resolveAchievementStatus(progress, row.targetValue, completed),
      unlockedAt: row.userProgress?.completedAt?.toISOString(),
      nextTierKey: row.nextTierKey,
      relatedStatKey: row.relatedStatKey,
    };
  });

  const unlockedCount = achievements.filter(
    (a) => a.status === "completed",
  ).length;

  return {
    level: xpSummary.level,
    totalXp: xpSummary.totalXp,
    progressPercent: xpSummary.progressPercent,
    xpIntoLevel: xpSummary.xpIntoLevel,
    xpForNextLevel: xpSummary.xpForNextLevel,
    xpRemainingToNextLevel: xpSummary.xpRemainingToNextLevel,
    streak: streak.current,
    achievements,
    unlockedCount,
    totalAchievements: achievements.length,
  };
}

export { findAchievementByKey } from "@/lib/achievements/findAchievementByKey";
