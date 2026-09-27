import { rarityRank } from "@/lib/achievements/achievementTheme";
import type { UserAchievementView } from "@/lib/achievements/types";

export type FeaturedAchievementKind =
  | "recent_unlock"
  | "closest"
  | "rarest_unlocked";

export type FeaturedAchievementResult = {
  achievement: UserAchievementView;
  kind: FeaturedAchievementKind;
  remaining: number;
  progressPercent: number;
};

const RECENT_UNLOCK_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Picks the emotional focal achievement:
 * 1) recent unlock, 2) closest to unlock, 3) rarest unlocked.
 */
export function selectFeaturedAchievement(
  achievements: UserAchievementView[],
): FeaturedAchievementResult | null {
  if (achievements.length === 0) return null;

  const now = Date.now();

  const recentUnlocks = achievements
    .filter(
      (a) =>
        a.status === "completed" &&
        a.unlockedAt &&
        now - new Date(a.unlockedAt).getTime() < RECENT_UNLOCK_MS,
    )
    .sort((a, b) => {
      const rarityDiff = rarityRank(b.rarity) - rarityRank(a.rarity);
      if (rarityDiff !== 0) return rarityDiff;
      return (
        new Date(b.unlockedAt!).getTime() - new Date(a.unlockedAt!).getTime()
      );
    });

  if (recentUnlocks[0]) {
    const a = recentUnlocks[0];
    return {
      achievement: a,
      kind: "recent_unlock",
      remaining: 0,
      progressPercent: 100,
    };
  }

  const closest = achievements
    .filter((a) => a.status === "in_progress" && a.target > 0)
    .map((a) => ({
      a,
      pct: a.progress / a.target,
      remaining: Math.max(0, a.target - a.progress),
    }))
    .sort((x, y) => y.pct - x.pct);

  if (closest[0]) {
    const { a, pct, remaining } = closest[0];
    return {
      achievement: a,
      kind: "closest",
      remaining,
      progressPercent: Math.round(pct * 100),
    };
  }

  const rarestUnlocked = achievements
    .filter((a) => a.status === "completed")
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));

  if (rarestUnlocked[0]) {
    const a = rarestUnlocked[0];
    return {
      achievement: a,
      kind: "rarest_unlocked",
      remaining: 0,
      progressPercent: 100,
    };
  }

  return null;
}
