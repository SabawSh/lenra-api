import type { User } from "@/lib/db/queries/users";
import { normalizeTotalXp } from "@/lib/gamification/levels";

/**
 * Reads lifetime XP from a user row (handles pre-migration `totalXp` if present).
 */
export function readUserTotalXp(
  user: Pick<User, "xp"> & { totalXp?: number | null },
): number {
  if (user.xp != null) return normalizeTotalXp(user.xp);
  if (user.totalXp != null) return normalizeTotalXp(user.totalXp);
  return 0;
}
