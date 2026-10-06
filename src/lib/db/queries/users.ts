/**
 * Typed MySQL accessors for `users` (snake_case table/columns in SQL;
 * camelCase domain types mirrored from legacy Prisma `User`).
 */
import { randomUUID } from "crypto";
import { pool } from "@/lib/db/connection";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";
import { CURRENT_LEGAL_VERSION } from "@/lib/legal/legalVersion";
import type { JsonValue } from "@/types/json";
import type { EnglishLevel, UserId } from "@/types/schema";
import type {
  Pool,
  PoolConnection,
  RowDataPacket,
  ResultSetHeader,
} from "mysql2/promise";

export type { EnglishLevel };

/** Row shape straight from MySQL (snake_case column names). */
export interface UserRow extends RowDataPacket {
  id: UserId;
  email: string | null;
  name: string | null;
  created_at: Date;
  avatar_url: string | null;
  last_active: Date | null;
  total_learning_time_ms: number;
  xp: number;
  level: number;
  learning_streak_current: number;
  learning_streak_best: number;
  last_learning_streak_day_key: string | null;
  last_learning_streak_at: Date | null;
  phone: string | null;
  google_id: string | null;
  email_verified_at: Date | null;
  phone_verified_at: Date | null;
  content_prefs: unknown;
  daily_goal_minutes: number;
  english_level: EnglishLevel | null;
  overall_skill: number | null;
  native_language: string | null;
  onboarding_completed_at: Date | null;
  terms_accepted_at: Date | null;
  privacy_accepted_at: Date | null;
  legal_version: string | null;
  username: string | null;
  is_site_admin: number | boolean;
}

/** Application `User` shape (camelCase), compatible with former Prisma `User`. */
export type User = {
  id: UserId;
  email: string | null;
  name: string | null;
  createdAt: Date;
  avatarUrl: string | null;
  lastActive: Date | null;
  totalLearningTimeMs: number;
  xp: number;
  level: number;
  learningStreakCurrent: number;
  learningStreakBest: number;
  lastLearningStreakDayKey: string | null;
  lastLearningStreakAt: Date | null;
  phone: string | null;
  googleId: string | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  contentPrefs: JsonValue;
  dailyGoalMinutes: number;
  englishLevel: EnglishLevel | null;
  /** Live Adaptive Teacher skill on 0–100; null until EMA history exists. */
  overallSkill: number | null;
  nativeLanguage: string | null;
  onboardingCompletedAt: Date | null;
  termsAcceptedAt: Date | null;
  privacyAcceptedAt: Date | null;
  legalVersion: string | null;
  username: string | null;
  isSiteAdmin: boolean;
};

export type UserStreakSlice = Pick<
  User,
  | "learningStreakCurrent"
  | "learningStreakBest"
  | "lastLearningStreakDayKey"
  | "lastLearningStreakAt"
>;

export type UserOnboardingSlice = Pick<
  User,
  | "id"
  | "username"
  | "englishLevel"
  | "contentPrefs"
  | "dailyGoalMinutes"
  | "onboardingCompletedAt"
>;

export type UserXpLevelSlice = Pick<User, "xp" | "level">;

export type UserAchievementTotalsSlice = Pick<
  User,
  "xp" | "totalLearningTimeMs" | "learningStreakBest"
>;

type DbQueryable = Pool | PoolConnection;

/** Values accepted by `mysql2` prepared statements. */
type SqlParam =
  | string
  | number
  | boolean
  | Date
  | bigint
  | Buffer
  | null;

let hasIsSiteAdminColumnCache: boolean | null = null;

async function hasIsSiteAdminColumn(): Promise<boolean> {
  if (hasIsSiteAdminColumnCache != null) return hasIsSiteAdminColumnCache;
  type ColumnRow = RowDataPacket & { has_col: number };
  const [rows] = await pool.query<ColumnRow[]>(
    `
      SELECT COUNT(*) AS has_col
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'is_site_admin'
    `,
  );
  hasIsSiteAdminColumnCache = Number(rows[0]?.has_col ?? 0) > 0;
  return hasIsSiteAdminColumnCache;
}

async function allUserColumnsSql(): Promise<string> {
  const hasExplicitAdmin = await hasIsSiteAdminColumn();
  return `
    id,
    email,
    name,
    created_at AS created_at,
    avatar_url AS avatar_url,
    last_active AS last_active,
    total_learning_time_ms AS total_learning_time_ms,
    xp AS xp,
    level AS level,
    learning_streak_current AS learning_streak_current,
    learning_streak_best AS learning_streak_best,
    last_learning_streak_day_key AS last_learning_streak_day_key,
    last_learning_streak_at AS last_learning_streak_at,
    phone AS phone,
    google_id AS google_id,
    ${hasExplicitAdmin ? "is_site_admin AS is_site_admin," : "0 AS is_site_admin,"}
    email_verified_at AS email_verified_at,
    phone_verified_at AS phone_verified_at,
    content_prefs AS content_prefs,
    daily_goal_minutes AS daily_goal_minutes,
    english_level AS english_level,
    overall_skill AS overall_skill,
    native_language AS native_language,
    onboarding_completed_at AS onboarding_completed_at,
    terms_accepted_at AS terms_accepted_at,
    privacy_accepted_at AS privacy_accepted_at,
    legal_version AS legal_version,
    username AS username
  `.replace(/\s+/g, " ");
}

function defaultQueryable(db?: DbQueryable): DbQueryable {
  return db ?? pool;
}

async function queryUserRowOptional(
  db: DbQueryable,
  sql: string,
  params: SqlParam[],
): Promise<UserRow | null> {
  const [rows] = await db.execute<UserRow[]>(sql, params);
  const row = rows[0];
  return row ?? null;
}

function parseJsonColumn(raw: unknown): JsonValue {
  if (raw == null) return [];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as JsonValue;
    } catch {
      return [];
    }
  }
  if (typeof raw === "boolean" || typeof raw === "number") return raw;
  if (Array.isArray(raw) || typeof raw === "object") return raw as JsonValue;
  return String(raw);
}

/** Map DB row → app `User` (camelCase). */
export function mapUserRowToUser(row: UserRow): User {
  return {
    id: String(row.id),
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
    avatarUrl: row.avatar_url,
    lastActive: row.last_active,
    totalLearningTimeMs: row.total_learning_time_ms,
    xp: row.xp,
    level: row.level,
    learningStreakCurrent: row.learning_streak_current,
    learningStreakBest: row.learning_streak_best,
    lastLearningStreakDayKey: row.last_learning_streak_day_key,
    lastLearningStreakAt: row.last_learning_streak_at,
    phone: row.phone,
    googleId: row.google_id,
    emailVerifiedAt: row.email_verified_at,
    phoneVerifiedAt: row.phone_verified_at,
    contentPrefs: parseJsonColumn(row.content_prefs),
    dailyGoalMinutes: row.daily_goal_minutes,
    englishLevel: row.english_level,
    overallSkill:
      row.overall_skill != null && Number.isFinite(Number(row.overall_skill))
        ? Number(row.overall_skill)
        : null,
    nativeLanguage: row.native_language,
    onboardingCompletedAt: row.onboarding_completed_at,
    termsAcceptedAt: row.terms_accepted_at,
    privacyAcceptedAt: row.privacy_accepted_at,
    legalVersion: row.legal_version,
    username: row.username,
    isSiteAdmin: Boolean(row.is_site_admin),
  };
}

/** True when MySQL rejects a unique constraint (e.g. username already taken). */
export function isDuplicateKeyMysqlError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return "errno" in error && (error as { errno: unknown }).errno === 1062;
}

export async function getUserById(
  id: UserId,
  executor?: DbQueryable,
): Promise<User | null> {
  const db = defaultQueryable(executor);
  const cols = await allUserColumnsSql();
  const row = await queryUserRowOptional(
    db,
    `SELECT ${cols} FROM users WHERE id = ? LIMIT 1`,
    [id],
  );
  return row ? mapUserRowToUser(row) : null;
}

export async function findUserXpAndLevelById(
  userId: UserId,
  executor?: DbQueryable,
): Promise<UserXpLevelSlice | null> {
  const db = defaultQueryable(executor);
  type R = Pick<UserRow, "xp" | "level"> & RowDataPacket;
  const sql = `
    SELECT xp, level
    FROM users
    WHERE id = ?
    LIMIT 1
  `;
  const [rows] = await db.execute<R[]>(sql, [userId]);
  const row = rows[0];
  if (!row) return null;
  return { xp: row.xp, level: row.level };
}

export async function findUserEnglishLevelById(
  userId: UserId,
  executor?: DbQueryable,
): Promise<EnglishLevel | null> {
  const db = defaultQueryable(executor);
  type R = Pick<UserRow, "english_level"> & RowDataPacket;
  const [rows] = await db.execute<R[]>(
    `
    SELECT english_level
    FROM users
    WHERE id = ?
    LIMIT 1
    `,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return row.english_level;
}

export async function findUserTotalsForAchievementMetrics(
  userId: UserId,
  executor?: DbQueryable,
): Promise<UserAchievementTotalsSlice | null> {
  const db = defaultQueryable(executor);
  const sql = `
    SELECT
      xp AS xp,
      total_learning_time_ms AS total_learning_time_ms,
      learning_streak_best AS learning_streak_best
    FROM users
    WHERE id = ?
    LIMIT 1
  `;
  type R = Pick<
    UserRow,
    "xp" | "total_learning_time_ms" | "learning_streak_best"
  > &
    RowDataPacket;
  const [rows] = await db.execute<R[]>(sql, [userId]);
  const row = rows[0];
  if (!row) return null;
  return {
    xp: row.xp,
    totalLearningTimeMs: row.total_learning_time_ms,
    learningStreakBest: row.learning_streak_best,
  };
}

export async function findUserStreakSliceById(
  userId: UserId,
  executor?: DbQueryable,
): Promise<UserStreakSlice | null> {
  const db = defaultQueryable(executor);
  type R = Pick<
    UserRow,
    | "learning_streak_current"
    | "learning_streak_best"
    | "last_learning_streak_day_key"
    | "last_learning_streak_at"
  > &
    RowDataPacket;
  const sql = `
    SELECT
      learning_streak_current AS learning_streak_current,
      learning_streak_best AS learning_streak_best,
      last_learning_streak_day_key AS last_learning_streak_day_key,
      last_learning_streak_at AS last_learning_streak_at
    FROM users
    WHERE id = ?
    LIMIT 1
  `;
  const [rows] = await db.execute<R[]>(sql, [userId]);
  const row = rows[0];
  if (!row) return null;
  return {
    learningStreakCurrent: row.learning_streak_current,
    learningStreakBest: row.learning_streak_best,
    lastLearningStreakDayKey: row.last_learning_streak_day_key,
    lastLearningStreakAt: row.last_learning_streak_at,
  };
}

export async function updateUserLearningStreak(
  userId: UserId,
  data: UserStreakSlice,
  executor?: DbQueryable,
): Promise<void> {
  const db = defaultQueryable(executor);
  await db.execute<ResultSetHeader>(
    `
      UPDATE users
      SET
        last_learning_streak_day_key = ?,
        last_learning_streak_at = ?,
        learning_streak_current = ?,
        learning_streak_best = ?
      WHERE id = ?
    `,
    [
      data.lastLearningStreakDayKey,
      data.lastLearningStreakAt,
      data.learningStreakCurrent,
      data.learningStreakBest,
      userId,
    ],
  );
}

export async function isUsernameTaken(
  normalizedUsername: string,
): Promise<boolean> {
  type R = { id: UserId } & RowDataPacket;
  const [rows] = await pool.execute<R[]>(
    `SELECT id FROM users WHERE username = ? LIMIT 1`,
    [normalizedUsername],
  );
  return rows.length > 0;
}

export async function existsOtherUsername(
  normalizedUsername: string,
  excludingUserId: UserId,
): Promise<boolean> {
  type R = { id: UserId } & RowDataPacket;
  const [rows] = await pool.execute<R[]>(
    `SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1`,
    [normalizedUsername, excludingUserId],
  );
  return rows.length > 0;
}

export type UpdateOnboardingPayload = {
  username?: string;
  englishLevel?: EnglishLevel;
  /** JSON-encoded string array, e.g. from `JSON.stringify(prefStrings)`. */
  contentPrefsJson?: string;
  dailyGoalMinutes?: number;
  onboardingCompletedAt?: Date;
};

/** Applies onboarding PATCH fields only; callers validate inputs. */
export async function updateUserOnboardingSlice(
  userId: UserId,
  patch: UpdateOnboardingPayload,
): Promise<UserOnboardingSlice | null> {
  const assigns: string[] = [];
  const values: SqlParam[] = [];

  if (patch.username !== undefined) {
    assigns.push("username = ?");
    values.push(patch.username);
  }
  if (patch.englishLevel !== undefined) {
    assigns.push("english_level = ?");
    values.push(patch.englishLevel);
  }
  if (patch.contentPrefsJson !== undefined) {
    assigns.push("content_prefs = ?");
    values.push(patch.contentPrefsJson);
  }
  if (patch.dailyGoalMinutes !== undefined) {
    assigns.push("daily_goal_minutes = ?");
    values.push(patch.dailyGoalMinutes);
  }
  if (patch.onboardingCompletedAt !== undefined) {
    assigns.push("onboarding_completed_at = ?");
    values.push(patch.onboardingCompletedAt);
  }

  if (assigns.length === 0) {
    throw new Error("updateUserOnboardingSlice: empty patch");
  }

  values.push(userId);

  await pool.execute<ResultSetHeader>(
    `UPDATE users SET ${assigns.join(", ")} WHERE id = ?`,
    values,
  );

  type R = Pick<
    UserRow,
    | "id"
    | "username"
    | "english_level"
    | "content_prefs"
    | "daily_goal_minutes"
    | "onboarding_completed_at"
  > &
    RowDataPacket;

  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      id,
      username,
      english_level,
      content_prefs,
      daily_goal_minutes,
      onboarding_completed_at
    FROM users
    WHERE id = ?
    LIMIT 1
  `,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    englishLevel: row.english_level,
    contentPrefs: parseJsonColumn(row.content_prefs),
    dailyGoalMinutes: row.daily_goal_minutes,
    onboardingCompletedAt: row.onboarding_completed_at,
  };
}

export async function findUserByGoogleId(
  googleId: string,
): Promise<User | null> {
  const cols = await allUserColumnsSql();
  const row = await queryUserRowOptional(
    pool,
    `SELECT ${cols} FROM users WHERE google_id = ? LIMIT 1`,
    [googleId],
  );
  return row ? mapUserRowToUser(row) : null;
}

export async function findUserByEmail(
  email: string,
): Promise<User | null> {
  const cols = await allUserColumnsSql();
  const row = await queryUserRowOptional(
    pool,
    `SELECT ${cols} FROM users WHERE email = ? LIMIT 1`,
    [email],
  );
  return row ? mapUserRowToUser(row) : null;
}

export async function insertUserViaGoogleSignup(data: {
  googleId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  lastActive: Date;
}): Promise<User> {
  const id = randomUUID();
  await pool.execute<ResultSetHeader>(
    `
      INSERT INTO users (
        id,
        google_id,
        email,
        name,
        avatar_url,
        email_verified_at,
        last_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      data.googleId,
      data.email,
      data.name,
      data.avatarUrl,
      data.emailVerifiedAt,
      data.lastActive,
    ],
  );
  const created = await getUserById(id);
  if (!created)
    throw new Error("insertUserViaGoogleSignup: insert succeeded but row missing");
  return created;
}

export async function updateUserGoogleLinkedAccount(
  userId: UserId,
  patch: {
    googleId?: string | null;
    email?: string | null;
    name?: string | null;
    avatarUrl?: string | null;
    emailVerifiedAt?: Date | null;
    lastActive?: Date | null;
  },
): Promise<User | null> {
  const assigns: string[] = [];
  const vals: SqlParam[] = [];

  if (patch.googleId !== undefined) {
    assigns.push("google_id = ?");
    vals.push(patch.googleId);
  }
  if (patch.email !== undefined) {
    assigns.push("email = ?");
    vals.push(patch.email);
  }
  if (patch.name !== undefined) {
    assigns.push("name = ?");
    vals.push(patch.name);
  }
  if (patch.avatarUrl !== undefined) {
    assigns.push("avatar_url = ?");
    vals.push(patch.avatarUrl);
  }
  if (patch.emailVerifiedAt !== undefined) {
    assigns.push("email_verified_at = ?");
    vals.push(patch.emailVerifiedAt);
  }
  if (patch.lastActive !== undefined) {
    assigns.push("last_active = ?");
    vals.push(patch.lastActive);
  }

  if (assigns.length === 0) return getUserById(userId);

  vals.push(userId);
  await pool.execute<ResultSetHeader>(
    `UPDATE users SET ${assigns.join(", ")} WHERE id = ?`,
    vals,
  );
  return getUserById(userId);
}

/** New account after OTP (username chosen during onboarding). */
export async function insertUserViaPhoneSignup(data: {
  phone: string;
  phoneVerifiedAt: Date;
  lastActive: Date;
}): Promise<User> {
  const id = randomUUID();
  await pool.execute<ResultSetHeader>(
    `
      INSERT INTO users (
        id,
        phone,
        phone_verified_at,
        last_active
      )
      VALUES (?, ?, ?, ?)
    `,
    [id, data.phone, data.phoneVerifiedAt, data.lastActive],
  );
  const created = await getUserById(id);
  if (!created)
    throw new Error("insertUserViaPhoneSignup: insert succeeded but row missing");
  return created;
}

/**
 * @deprecated Prefer `insertUserViaPhoneSignup` + `user_auth_methods`. Kept for scripts.
 * Creates or bumps `phoneVerifiedAt` / `lastActive` keyed by phone (unique column).
 */
export async function upsertUserByVerifiedPhone(params: {
  phone: string;
  phoneVerifiedAt: Date;
  lastActive: Date;
}): Promise<User> {
  const id = randomUUID();
  await pool.execute<ResultSetHeader>(
    `
      INSERT INTO users (id, phone, phone_verified_at, last_active)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        phone_verified_at = VALUES(phone_verified_at),
        last_active = VALUES(last_active)
    `,
    [id, params.phone, params.phoneVerifiedAt, params.lastActive],
  );

  const row = await queryUserRowOptional(
    pool,
    `SELECT ${await allUserColumnsSql()} FROM users WHERE phone = ? LIMIT 1`,
    [params.phone],
  );
  if (!row) throw new Error("upsertUserByVerifiedPhone: row missing after upsert");
  return mapUserRowToUser(row);
}

export async function updateUserLastActiveNow(
  userId: UserId,
): Promise<User | null> {
  const now = new Date();
  await pool.execute<ResultSetHeader>(
    `UPDATE users SET last_active = ? WHERE id = ?`,
    [now, userId],
  );
  return getUserById(userId);
}

export async function incrementUserTotalLearningTimeMs(
  userId: UserId,
  deltaMs: number,
  executor?: DbQueryable,
): Promise<void> {
  const db = defaultQueryable(executor);
  await db.execute<ResultSetHeader>(
    `UPDATE users SET total_learning_time_ms = total_learning_time_ms + ? WHERE id = ?`,
    [deltaMs, userId],
  );
}

export async function setUserLifetimeXpAndLevel(
  userId: UserId,
  totalXp: number,
  computedLevel: number,
  executor?: DbQueryable,
): Promise<void> {
  const db = defaultQueryable(executor);
  await db.execute<ResultSetHeader>(
    `UPDATE users SET xp = ?, level = ? WHERE id = ?`,
    [totalXp, computedLevel, userId],
  );
}

export async function updateUserAvatarUrl(
  userId: UserId,
  avatarUrl: string | null,
): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `UPDATE users SET avatar_url = ? WHERE id = ?`,
    [avatarUrl, userId],
  );
}

export async function updateUserProfileName(
  userId: UserId,
  name: string,
): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `UPDATE users SET name = ? WHERE id = ?`,
    [name, userId],
  );
}

export async function updateUserLearningPreferences(params: {
  userId: UserId;
  englishLevel: EnglishLevel;
  contentPrefsJson: string;
  dailyGoalMinutes: number;
}): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `
      UPDATE users
      SET
        english_level = ?,
        content_prefs = ?,
        daily_goal_minutes = ?
      WHERE id = ?
    `,
    [
      params.englishLevel,
      params.contentPrefsJson,
      params.dailyGoalMinutes,
      params.userId,
    ],
  );
}

export async function updateUserDisplayNameAndUsername(params: {
  userId: UserId;
  name: string;
  username: string;
}): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `UPDATE users SET name = ?, username = ? WHERE id = ?`,
    [params.name, params.username, params.userId],
  );
}

export type AdminUserRow = Pick<
  User,
  | "id"
  | "name"
  | "username"
  | "email"
  | "phone"
  | "createdAt"
  | "lastActive"
  | "onboardingCompletedAt"
> & {
  isAdmin: boolean;
  isExplicitAdmin: boolean;
  isLegacyAdmin: boolean;
  activePlanKey: string | null;
  activePlanExpiresAt: Date | null;
};

export async function listUsersForAdmin(params?: {
  query?: string;
  limit?: number;
}): Promise<AdminUserRow[]> {
  const rawQuery = params?.query?.trim() ?? "";
  const limit = Math.max(1, Math.min(params?.limit ?? 50, 200));
  const hasExplicitAdmin = await hasIsSiteAdminColumn();

  const where: string[] = [];
  const values: SqlParam[] = [];

  if (rawQuery) {
    const like = `%${rawQuery}%`;
    where.push(`(
      id = ? OR
      LOWER(COALESCE(email, '')) LIKE LOWER(?) OR
      LOWER(COALESCE(username, '')) LIKE LOWER(?) OR
      LOWER(COALESCE(name, '')) LIKE LOWER(?) OR
      COALESCE(phone, '') LIKE ?
    )`);
    values.push(rawQuery, like, like, like, like);
  }

  type R = Pick<
    UserRow,
    | "id"
    | "name"
    | "username"
    | "email"
    | "phone"
    | "created_at"
    | "last_active"
    | "onboarding_completed_at"
    | "is_site_admin"
    | "active_plan_key"
    | "active_plan_expires_at"
  > &
    RowDataPacket;

  const [rows] = await pool.execute<R[]>(
    `
      SELECT
        id,
        name,
        username,
        email,
        phone,
        created_at,
        last_active,
        onboarding_completed_at,
        ${hasExplicitAdmin ? "is_site_admin" : "0 AS is_site_admin"},
        (
          SELECT us.plan_key
          FROM user_subscriptions us
          WHERE us.user_id = users.id
            AND us.status = 'active'
            AND us.expires_at > UTC_TIMESTAMP(3)
          ORDER BY us.expires_at DESC
          LIMIT 1
        ) AS active_plan_key,
        (
          SELECT us.expires_at
          FROM user_subscriptions us
          WHERE us.user_id = users.id
            AND us.status = 'active'
            AND us.expires_at > UTC_TIMESTAMP(3)
          ORDER BY us.expires_at DESC
          LIMIT 1
        ) AS active_plan_expires_at
      FROM users
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `,
    values,
  );

  return rows.map((row) => {
    const isExplicitAdmin = Boolean(row.is_site_admin);
    const isLegacyAdmin = isSiteMediaAdmin({
      email: row.email,
      phone: row.phone,
      isSiteAdmin: false,
    });
    return {
      id: row.id,
      name: row.name,
      username: row.username,
      email: row.email,
      phone: row.phone,
      createdAt: row.created_at,
      lastActive: row.last_active,
      onboardingCompletedAt: row.onboarding_completed_at,
      isAdmin: isExplicitAdmin || isLegacyAdmin,
      isExplicitAdmin,
      isLegacyAdmin,
      activePlanKey: row.active_plan_key ?? null,
      activePlanExpiresAt: row.active_plan_expires_at ?? null,
    };
  });
}

export async function adminUpdateUserBasics(params: {
  userId: UserId;
  name: string | null;
  username: string | null;
  email: string | null;
  phone: string | null;
}): Promise<User | null> {
  await pool.execute<ResultSetHeader>(
    `
      UPDATE users
      SET
        name = ?,
        username = ?,
        email = ?,
        phone = ?
      WHERE id = ?
    `,
    [params.name, params.username, params.email, params.phone, params.userId],
  );
  return getUserById(params.userId);
}

/**
 * Tables that historically drifted to ON DELETE NO ACTION after the UUID
 * migration. Cascade alone can fail with ER_ROW_IS_REFERENCED (1451); clear
 * them first so admin delete works even before the FK repair migration runs.
 */
const USER_DELETE_PRECLEAR_TABLES = [
  "user_part_progress",
  "user_achievements",
  "user_token_marks",
  "user_daily_learning_time",
  "user_daily_xp",
  "saved_vocabulary_cards",
  "user_video_last_seen",
] as const;

export async function deleteUserById(userId: UserId): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const table of USER_DELETE_PRECLEAR_TABLES) {
      await conn.execute(`DELETE FROM \`${table}\` WHERE user_id = ?`, [
        userId,
      ]);
    }

    const [result] = await conn.execute<ResultSetHeader>(
      `DELETE FROM users WHERE id = ?`,
      [userId],
    );

    await conn.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function setUserSiteAdminFlag(
  userId: UserId,
  isAdmin: boolean,
): Promise<User | null> {
  if (!(await hasIsSiteAdminColumn())) {
    throw new Error(
      "The users.is_site_admin column is missing. Run migration 20260709_users_is_site_admin.sql first.",
    );
  }
  await pool.execute<ResultSetHeader>(
    `UPDATE users SET is_site_admin = ? WHERE id = ?`,
    [isAdmin ? 1 : 0, userId],
  );
  return getUserById(userId);
}

export async function loadFirstUserByIdAsc(): Promise<User | null> {
  const cols = await allUserColumnsSql();
  const row = await queryUserRowOptional(
    pool,
    `SELECT ${cols} FROM users ORDER BY id ASC LIMIT 1`,
    [],
  );
  return row ? mapUserRowToUser(row) : null;
}

/** Persist Terms + Privacy acceptance for the current legal version. */
export async function recordLegalAcceptance(userId: UserId): Promise<User | null> {
  const now = new Date();
  await pool.execute<ResultSetHeader>(
    `
      UPDATE users
      SET
        terms_accepted_at = ?,
        privacy_accepted_at = ?,
        legal_version = ?
      WHERE id = ?
    `,
    [now, now, CURRENT_LEGAL_VERSION, userId],
  );
  return getUserById(userId);
}
