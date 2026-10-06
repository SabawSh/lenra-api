import { pool } from "@/lib/db/connection";
import { findUserEnglishLevelById } from "@/lib/db/queries/users";
import { clampSkill, priorFromEnglishLevel } from "@/lib/skill/constants";
import type { UserId } from "@/types/schema";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

/** Stale `in_progress` locks may be taken over after this TTL. */
export const SKILL_BACKFILL_LOCK_TTL_MS = 60_000;

export type SkillBackfillStatus = "none" | "in_progress" | "done";

export type SkillBackfillLockResult =
  | "acquired"
  | "in_progress"
  | "already_complete"
  | "not_needed";

export type SkillBackfillLockAcquire = {
  result: SkillBackfillLockResult;
  lockState:
    | "none"
    | "acquired"
    | "in_progress"
    | "already_complete"
    | "expired_takeover"
    | "not_needed";
};

type BackfillLockRow = RowDataPacket & {
  overall_skill: number | null;
  skill_backfill_status: SkillBackfillStatus;
  skill_backfill_expires_at: Date | null;
};

export async function findUserOverallSkill(
  userId: UserId,
): Promise<number | null> {
  type R = RowDataPacket & { overall_skill: number | null };
  const [rows] = await pool.execute<R[]>(
    `SELECT overall_skill FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  const v = rows[0]?.overall_skill;
  return v != null ? Number(v) : null;
}

async function findUserBackfillLockRow(
  userId: UserId,
): Promise<BackfillLockRow | null> {
  const [rows] = await pool.execute<BackfillLockRow[]>(
    `
    SELECT
      overall_skill,
      skill_backfill_status,
      skill_backfill_expires_at
    FROM users
    WHERE id = ?
    LIMIT 1
    `,
    [userId],
  );
  return rows[0] ?? null;
}

function isBackfillLockExpired(expiresAt: Date | null): boolean {
  if (expiresAt == null) return true;
  return expiresAt.getTime() <= Date.now();
}

export async function findUserSkillBackfillStatus(
  userId: UserId,
): Promise<SkillBackfillStatus> {
  const row = await findUserBackfillLockRow(userId);
  const status = row?.skill_backfill_status;
  if (
    status === "none" ||
    status === "in_progress" ||
    status === "done"
  ) {
    return status;
  }
  return "none";
}

export async function setUserOverallSkill(
  userId: UserId,
  skill: number,
): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `UPDATE users SET overall_skill = ? WHERE id = ?`,
    [skill, userId],
  );
}

/**
 * One-time Adaptive Teacher seed from onboarding english_level.
 * Never overwrites an existing overall_skill — progression stays independent of onboarding.
 * Returns the skill after seed (or existing), or null when neither skill nor level exists.
 */
export async function seedOverallSkillFromOnboardingIfAbsent(
  userId: UserId,
): Promise<number | null> {
  const existing = await findUserOverallSkill(userId);
  if (existing != null) return Number(existing);

  const englishLevel = await findUserEnglishLevelById(userId);
  if (englishLevel == null) return null;

  const seed = clampSkill(priorFromEnglishLevel(englishLevel));
  await pool.execute<ResultSetHeader>(
    `
    UPDATE users
    SET overall_skill = ?
    WHERE id = ?
      AND overall_skill IS NULL
    `,
    [seed, userId],
  );

  const after = await findUserOverallSkill(userId);
  return after != null ? Number(after) : seed;
}

function expiresAtFromNow(): Date {
  return new Date(Date.now() + SKILL_BACKFILL_LOCK_TTL_MS);
}

async function setBackfillLockInProgress(userId: UserId): Promise<boolean> {
  const expiresAt = expiresAtFromNow();
  const [hdr] = await pool.execute<ResultSetHeader>(
    `
    UPDATE users
    SET
      skill_backfill_status = 'in_progress',
      skill_backfill_expires_at = ?
    WHERE id = ?
      AND overall_skill IS NULL
      AND skill_backfill_status = 'none'
    `,
    [expiresAt, userId],
  );
  return hdr.affectedRows > 0;
}

async function takeoverExpiredBackfillLock(userId: UserId): Promise<boolean> {
  const expiresAt = expiresAtFromNow();
  const [hdr] = await pool.execute<ResultSetHeader>(
    `
    UPDATE users
    SET
      skill_backfill_status = 'in_progress',
      skill_backfill_expires_at = ?
    WHERE id = ?
      AND overall_skill IS NULL
      AND skill_backfill_status = 'in_progress'
      AND (
        skill_backfill_expires_at IS NULL
        OR skill_backfill_expires_at < NOW(3)
      )
    `,
    [expiresAt, userId],
  );
  return hdr.affectedRows > 0;
}

/**
 * DB-level backfill lock with 60s TTL. Stale `in_progress` locks are overrideable.
 * Must be checked before `backfillSkillFromCompletedSections`.
 */
export async function acquireSkillBackfillLock(
  userId: UserId,
): Promise<SkillBackfillLockAcquire> {
  const row = await findUserBackfillLockRow(userId);
  if (!row) {
    return { result: "not_needed", lockState: "not_needed" };
  }

  if (row.overall_skill != null) {
    return { result: "already_complete", lockState: "already_complete" };
  }

  const status = row.skill_backfill_status;
  if (status === "done") {
    return { result: "already_complete", lockState: "already_complete" };
  }

  if (status === "in_progress") {
    if (!isBackfillLockExpired(row.skill_backfill_expires_at)) {
      return { result: "in_progress", lockState: "in_progress" };
    }

    const tookOver = await takeoverExpiredBackfillLock(userId);
    if (tookOver) {
      return { result: "acquired", lockState: "expired_takeover" };
    }

    const skillAfterRace = await findUserOverallSkill(userId);
    if (skillAfterRace != null) {
      return { result: "already_complete", lockState: "already_complete" };
    }
    return { result: "in_progress", lockState: "in_progress" };
  }

  const acquired = await setBackfillLockInProgress(userId);
  if (acquired) {
    return { result: "acquired", lockState: "acquired" };
  }

  const skillAfterRace = await findUserOverallSkill(userId);
  if (skillAfterRace != null) {
    return { result: "already_complete", lockState: "already_complete" };
  }

  const rowAfterRace = await findUserBackfillLockRow(userId);
  if (
    rowAfterRace?.skill_backfill_status === "in_progress" &&
    isBackfillLockExpired(rowAfterRace.skill_backfill_expires_at)
  ) {
    const tookOver = await takeoverExpiredBackfillLock(userId);
    if (tookOver) {
      return { result: "acquired", lockState: "expired_takeover" };
    }
  }

  if (rowAfterRace?.skill_backfill_status === "in_progress") {
    return { result: "in_progress", lockState: "in_progress" };
  }

  return { result: "in_progress", lockState: "in_progress" };
}

export async function markSkillBackfillDone(userId: UserId): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `
    UPDATE users
    SET
      skill_backfill_status = 'done',
      skill_backfill_expires_at = NULL
    WHERE id = ?
    `,
    [userId],
  );
}

/** Reset lock after failed backfill so a later request can retry. */
export async function releaseSkillBackfillLock(userId: UserId): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `
    UPDATE users
    SET
      skill_backfill_status = 'none',
      skill_backfill_expires_at = NULL
    WHERE id = ?
      AND overall_skill IS NULL
      AND skill_backfill_status = 'in_progress'
    `,
    [userId],
  );
}

/** Idempotent section skill application — returns false if already applied. */
export async function tryRecordAdaptiveSkillSection(
  userId: UserId,
  sectionKey: string,
): Promise<boolean> {
  try {
    const [hdr] = await pool.execute<ResultSetHeader>(
      `
      INSERT INTO user_adaptive_skill_sections (user_id, section_key)
      VALUES (?, ?)
      `,
      [userId, sectionKey],
    );
    return hdr.affectedRows > 0;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "ER_DUP_ENTRY") return false;
    throw err;
  }
}

export async function countAdaptiveSkillSectionsApplied(
  userId: UserId,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c
    FROM user_adaptive_skill_sections
    WHERE user_id = ?
    `,
    [userId],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

export async function isAdaptiveSkillSectionApplied(
  userId: UserId,
  sectionKey: string,
): Promise<boolean> {
  type R = RowDataPacket & { one: number };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT 1 AS one
    FROM user_adaptive_skill_sections
    WHERE user_id = ? AND section_key = ?
    LIMIT 1
    `,
    [userId, sectionKey],
  );
  return rows.length > 0;
}
