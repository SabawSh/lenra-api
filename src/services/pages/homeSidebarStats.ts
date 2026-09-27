import { getStreakForUser } from "@/lib/db/learningStreak";
import { getUserXpSummary } from "@/lib/db/userXp";
import type { UserId } from "@/types/schema";

export async function buildHomeSidebarStats(userId: UserId) {
  const [progression, streak] = await Promise.all([
    getUserXpSummary(userId),
    getStreakForUser(userId),
  ]);
  return { progression, streakCurrent: streak.current };
}
