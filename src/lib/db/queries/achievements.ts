/**
 * Achievement definitions + per-user progress (`achievement_definitions`, `user_achievements`).
 */
import { randomUUID } from "crypto";
import type { AchievementDefinitionSeed } from "@/lib/achievements/definitions";
import { pool } from "@/lib/db/connection";
import type {
  AchievementCategory,
  AchievementRarity,
  UserId,
} from "@/types/schema";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

type SqlScalar =
  | string
  | number
  | boolean
  | Date
  | bigint
  | Buffer
  | null;

function tinyBool(v: unknown): boolean {
  return Number(v) === 1;
}

export type AchievementDefinitionCamel = {
  id: string;
  key: string;
  title: string;
  description: string;
  category: AchievementCategory;
  rarity: AchievementRarity;
  icon: string;
  xpReward: number;
  targetValue: number;
  tier: number;
  nextTierKey: string | null;
  relatedStatKey: string | null;
  createdAt: Date;
};

function mapDefinitionRow(r: Record<string, unknown>): AchievementDefinitionCamel {
  return {
    id: String(r.id),
    key: String(r.def_key ?? r.key),
    title: String(r.title),
    description: String(r.description),
    category: r.category as AchievementCategory,
    rarity: r.rarity as AchievementRarity,
    icon: String(r.icon),
    xpReward: Number(r.xp_reward),
    targetValue: Number(r.target_value),
    tier: Number(r.tier),
    nextTierKey:
      r.next_tier_key != null ? String(r.next_tier_key) : null,
    relatedStatKey:
      r.related_stat_key != null ? String(r.related_stat_key) : null,
    createdAt: r.created_at as Date,
  };
}

export type UserAchievementCamel = {
  id: string;
  userId: UserId;
  achievementId: string;
  progress: number;
  completed: boolean;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapUserAchievementRow(
  r: Record<string, unknown>,
): UserAchievementCamel {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    achievementId: String(r.achievement_id),
    progress: Number(r.progress),
    completed: tinyBool(r.completed),
    completedAt:
      r.completed_at != null ? (r.completed_at as Date) : null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

/** Stable id matches `key` for idempotent DDL + FK references. */
export async function upsertAchievementDefinitionSeed(
  seed: AchievementDefinitionSeed,
): Promise<void> {
  const id = seed.key;
  await pool.execute<ResultSetHeader>(
    `
    INSERT INTO achievement_definitions (
      id, \`key\`, title, description, category, rarity, icon,
      xp_reward, target_value, tier, next_tier_key, related_stat_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      title = VALUES(title),
      description = VALUES(description),
      category = VALUES(category),
      rarity = VALUES(rarity),
      icon = VALUES(icon),
      xp_reward = VALUES(xp_reward),
      target_value = VALUES(target_value),
      tier = VALUES(tier),
      next_tier_key = VALUES(next_tier_key),
      related_stat_key = VALUES(related_stat_key)
    `,
    [
      id,
      seed.key,
      seed.title,
      seed.description,
      seed.category,
      seed.rarity,
      seed.icon,
      seed.xpReward,
      seed.targetValue,
      seed.tier ?? 1,
      seed.nextTierKey ?? null,
      seed.relatedStatKey ?? null,
    ] as SqlScalar[],
  );
}

export async function listAchievementDefinitionsOrdered(): Promise<
  AchievementDefinitionCamel[]
> {
  const [rows] = await pool.execute<(RowDataPacket & Record<string, unknown>)[]>(
    `
    SELECT
      id,
      \`key\` AS def_key,
      title,
      description,
      category,
      rarity,
      icon,
      xp_reward,
      target_value,
      tier,
      next_tier_key,
      related_stat_key,
      created_at
    FROM achievement_definitions
    ORDER BY category ASC, tier ASC
    `,
  );
  return rows.map((r) => mapDefinitionRow(r as Record<string, unknown>));
}

export async function countAchievementDefinitions(): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `SELECT COUNT(*) AS c FROM achievement_definitions`,
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

export async function listUserAchievementsForUser(
  userId: UserId,
): Promise<UserAchievementCamel[]> {
  const [rows] = await pool.execute<(RowDataPacket & Record<string, unknown>)[]>(
    `
    SELECT *
    FROM user_achievements
    WHERE user_id = ?
    `,
    [userId],
  );
  return rows.map((r) => mapUserAchievementRow(r as Record<string, unknown>));
}

export async function countUserAchievementsCompleted(
  userId: UserId,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c FROM user_achievements
    WHERE user_id = ? AND completed = 1
    `,
    [userId],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

export async function upsertUserAchievementRow(params: {
  userId: UserId;
  achievementId: string;
  progress: number;
  completed: boolean;
  completedAt: Date | null;
}): Promise<void> {
  const id = randomUUID();
  await pool.execute<ResultSetHeader>(
    `
    INSERT INTO user_achievements (
      id, user_id, achievement_id, progress, completed, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      progress = VALUES(progress),
      completed = VALUES(completed),
      completed_at = VALUES(completed_at),
      updated_at = CURRENT_TIMESTAMP(3)
    `,
    [
      id,
      params.userId,
      params.achievementId,
      params.progress,
      params.completed ? 1 : 0,
      params.completedAt,
    ] as SqlScalar[],
  );
}
