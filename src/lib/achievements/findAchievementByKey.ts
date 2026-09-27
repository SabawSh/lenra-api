import type { UserAchievementView } from "@/lib/achievements/types";

export function findAchievementByKey(
  achievements: UserAchievementView[],
  key: string | null | undefined,
): UserAchievementView | undefined {
  if (!key) return undefined;
  return achievements.find((a) => a.id === key);
}
