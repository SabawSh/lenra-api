import { syncUserAchievements } from "@/lib/achievements/engine";
import { alignLearningStreakWithActivity } from "@/lib/db/learningStreak";
import { updateUserLastActiveNow } from "@/lib/db/queries/users";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import type { UserId } from "@/types/schema";

/** Side effects after dashboard view (same as former Next `after()` block). */
export async function runDashboardVisitSideEffects(userId: UserId) {
  await Promise.allSettled([
    updateUserLastActiveNow(userId).catch(() => null),
    alignLearningStreakWithActivity(userId).catch(() => null),
    syncUserAchievements(userId).catch(() => null),
  ]);
}

export async function runDashboardVisitForRequest() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, reason: "unauthorized" };
  await runDashboardVisitSideEffects(user.id);
  return { ok: true as const };
}
