import { getLevelFromXp, normalizeTotalXp } from "@/lib/gamification/levels";
import { readUserTotalXp } from "@/lib/gamification/readUserXp";
import { findUserXpAndLevelById } from "@/lib/db/queries/users";

import type { UserId } from "@/types/schema";
export type UserGamificationRow = {
  totalXp: number;
  level: number;
};

/** Reads lifetime XP + level from `users`. */
export async function fetchUserGamification(
  userId: UserId,
): Promise<UserGamificationRow> {
  const row = await findUserXpAndLevelById(userId);
  if (row) {
    const totalXp = readUserTotalXp(row);
    return {
      totalXp,
      level: row.level > 0 ? row.level : getLevelFromXp(totalXp),
    };
  }

  return { totalXp: 0, level: 1 };
}
