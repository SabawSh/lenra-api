
import { withTransaction } from "@/lib/db/connection";
import { localDateKey } from "@/lib/db/localDateKey";
import { incrementUserDailyXp } from "@/lib/db/queries/progress";
import {
  findUserXpAndLevelById,
  setUserLifetimeXpAndLevel,
} from "@/lib/db/queries/users";
import { assertUserId } from "@/lib/db/userId";
import {
  getCurrentLevelProgress,
  getLevelFromXp,
} from "@/lib/gamification/levels";
import type { AwardXpParams, AwardXpResult } from "@/lib/gamification/xp";

/** Transaction-safe XP award — single source of truth for all gamification XP. */
export async function awardXp({
  userId,
  amount,
  reason = "complete_clip",
}: AwardXpParams): Promise<AwardXpResult> {
  const xpGained = Math.max(0, Math.round(amount));

  assertUserId(userId);

  if (xpGained <= 0) {
    const user = await findUserXpAndLevelById(userId);
    const totalXp = user?.xp ?? 0;
    const progress = getCurrentLevelProgress(totalXp);
    const level = user?.level ?? getLevelFromXp(totalXp);
    return {
      previousLevel: level,
      newLevel: level,
      leveledUp: false,
      totalXp,
      xpGained: 0,
      xpIntoLevel: progress.xpIntoLevel,
      xpForNextLevel: progress.xpForNextLevel,
      reason,
    };
  }

  const dayKey = localDateKey();

  const result = await withTransaction(async (conn) => {
    const user = await findUserXpAndLevelById(userId, conn);

    if (!user) {
      throw new Error("User not found");
    }

    const previousLevel = user.level;
    const totalXp = user.xp + xpGained;
    const newLevel = getLevelFromXp(totalXp);
    const progress = getCurrentLevelProgress(totalXp);

    await setUserLifetimeXpAndLevel(userId, totalXp, newLevel, conn);

    const res = await incrementUserDailyXp(conn, userId, dayKey, xpGained);

    return {
      previousLevel,
      newLevel,
      leveledUp: newLevel > previousLevel,
      totalXp,
      xpGained,
      xpIntoLevel: progress.xpIntoLevel,
      xpForNextLevel: progress.xpForNextLevel,
      reason,
    };
  });

  return result;
}
