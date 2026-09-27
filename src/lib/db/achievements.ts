import { getAchievementsPageData } from "@/lib/achievements/getPageData";
import type {
  AchievementStatus,
  UserAchievementView,
} from "@/lib/achievements/types";
import type { UserId } from "@/types/schema";

export type { AchievementStatus };

/** Dashboard preview row — same shape as achievements page cards. */
export type DashboardAchievement = UserAchievementView;

export function getDefaultUserAchievements(): DashboardAchievement[] {
  return [];
}

/** In-progress or recently completed achievements for the dashboard strip. */
export async function getUserAchievements(
  userId: UserId,
  { skipSync = true }: { skipSync?: boolean } = {},
): Promise<DashboardAchievement[]> {
  const { achievements } = await getAchievementsPageData(userId, { skipSync });

  const prioritized = [...achievements].sort((a, b) => {
    const order: Record<AchievementStatus, number> = {
      in_progress: 0,
      completed: 1,
      locked: 2,
    };
    return order[a.status] - order[b.status];
  });

  return prioritized.slice(0, 4);
}
