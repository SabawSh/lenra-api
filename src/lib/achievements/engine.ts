import { ensureAchievementDefinitions } from "@/lib/achievements/ensureDefinitions";
import {
  computeUserAchievementMetrics,
  type UserAchievementMetrics,
} from "@/lib/achievements/metrics";
import { progressForAchievementKey } from "@/lib/achievements/progress";
import type { AchievementStatus } from "@/lib/achievements/types";
import type {
  AchievementDefinitionCamel,
  UserAchievementCamel,
} from "@/lib/db/queries/achievements";
import {
  listAchievementDefinitionsOrdered,
  listUserAchievementsForUser,
  upsertUserAchievementRow,
} from "@/lib/db/queries/achievements";
import { findUserXpAndLevelById } from "@/lib/db/queries/users";
import { assertUserId } from "@/lib/db/userId";
import type { UserId } from "@/types/schema";
import { unstable_cache } from "next/cache";
import { cache } from "react";

/**
 * Achievement definitions are static (only change on code deploys).
 * Cache them for 1 hour to avoid the upsert loop on every cold start.
 */
const getCachedAchievementDefinitions = unstable_cache(
  async (): Promise<AchievementDefinitionCamel[]> => {
    let defs = await listAchievementDefinitionsOrdered();
    if (defs.length === 0) {
      await ensureAchievementDefinitions();
      defs = await listAchievementDefinitionsOrdered();
    }
    return defs;
  },
  ["achievement-definitions"],
  { revalidate: 3600, tags: ["achievement-definitions"] },
);

export type UnlockedAchievementPayload = {
  key: string;
  title: string;
  xpReward: number;
  rarity: string;
  icon: string;
};

export type SyncUserAchievementsResult = {
  newlyUnlocked: UnlockedAchievementPayload[];
  totalXpAwarded: number;
  leveledUp: boolean;
  newLevel: number;
};

export function resolveAchievementStatus(
  progress: number,
  target: number,
  completed: boolean,
): AchievementStatus {
  if (completed) return "completed";
  if (progress <= 0) return "locked";
  return "in_progress";
}

/**
 * Recomputes all achievement progress from live metrics, unlocks newly completed
 * achievements (visual rewards only — no XP).
 */
export async function syncUserAchievements(
  userId: UserId,
  metrics?: UserAchievementMetrics,
): Promise<SyncUserAchievementsResult> {
  assertUserId(userId);
  await ensureAchievementDefinitions();

  const [definitions, liveMetrics, existingRows] = await Promise.all([
    listAchievementDefinitionsOrdered(),
    metrics ?? computeUserAchievementMetrics(userId),
    listUserAchievementsForUser(userId),
  ]);

  const existingByAchievementId = new Map(
    existingRows.map((row) => [row.achievementId, row]),
  );

  const newlyUnlocked: UnlockedAchievementPayload[] = [];
  let newLevel = 1;

  for (const def of definitions) {
    const rawProgress = progressForAchievementKey(def.key, liveMetrics);
    const progress = Math.min(Math.max(0, rawProgress), def.targetValue);
    const shouldComplete = progress >= def.targetValue;
    const existing = existingByAchievementId.get(def.id);
    const wasCompleted = existing?.completed ?? false;

    if (shouldComplete && !wasCompleted) {
      newlyUnlocked.push({
        key: def.key,
        title: def.title,
        xpReward: 0,
        rarity: def.rarity,
        icon: def.icon,
      });
    }

    await upsertUserAchievementRow({
      userId,
      achievementId: def.id,
      progress,
      completed: shouldComplete,
      completedAt: shouldComplete
        ? (existing?.completedAt ?? new Date())
        : null,
    });
  }

  if (newlyUnlocked.length === 0) {
    const slice = await findUserXpAndLevelById(userId);
    newLevel = slice?.level ?? 1;
  }

  return { newlyUnlocked, totalXpAwarded: 0, leveledUp: false, newLevel };
}

export type AchievementWithProgress = AchievementDefinitionCamel & {
  userProgress: UserAchievementCamel | null;
};

/** Load definitions merged with user rows. Definitions are cached; user rows are always fresh. */
export const getUserAchievementsWithDefinitions = cache(
  async (userId: UserId): Promise<AchievementWithProgress[]> => {
    assertUserId(userId);

    const [definitions, rows] = await Promise.all([
      getCachedAchievementDefinitions(),
      listUserAchievementsForUser(userId),
    ]);

    const byAchievementId = new Map(rows.map((r) => [r.achievementId, r]));

    return definitions.map((def) => ({
      ...def,
      userProgress: byAchievementId.get(def.id) ?? null,
    }));
  },
);
