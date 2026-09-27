import type { UserId } from "@/types/schema";
/**
 * Minimal mutations on progress-related tables (snake_case DDL).
 * Expanded in the dedicated `progress.ts` migration step.
 */
import { pool } from "@/lib/db/connection";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

type SqlParam =
  | string
  | number
  | boolean
  | Date
  | bigint
  | Buffer
  | null;

export async function incrementUserDailyXp(
  conn: PoolConnection,
  userId: UserId,
  dayKey: string,
  deltaXp: number,
): Promise<void> {
  const params: SqlParam[] = [userId, dayKey, deltaXp];
  await conn.execute<ResultSetHeader>(
    `
      INSERT INTO user_daily_xp (user_id, day_key, xp)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE xp = xp + VALUES(xp)
    `,
    params,
  );
}

export async function incrementUserDailyLearningTimeMs(
  conn: PoolConnection,
  userId: UserId,
  dayKey: string,
  deltaMs: number,
): Promise<void> {
  const params: SqlParam[] = [userId, dayKey, deltaMs];
  await conn.execute<ResultSetHeader>(
    `
      INSERT INTO user_daily_learning_time (user_id, day_key, learning_time_ms)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        learning_time_ms = learning_time_ms + VALUES(learning_time_ms)
    `,
    params,
  );
}

type SqlReadScalar =
  | string
  | number
  | boolean
  | Date
  | bigint
  | Buffer
  | null;

/** Progress rows for movie/documentary parts (via episode → season → video). */
export async function listUserPartProgressForStandaloneMovieVideos(
  userId: UserId,
  videoIds: string[],
): Promise<Array<{ partId: string; completedAt: Date | null }>> {
  return listUserPartProgressForSeriesVideos(userId, videoIds);
}

/** Progress rows for a user for parts under these root video IDs (episode → season). */
export async function listUserPartProgressForSeriesVideos(
  userId: UserId,
  videoIds: string[],
): Promise<Array<{ partId: string; completedAt: Date | null }>> {
  if (videoIds.length === 0) return [];
  const ph = videoIds.map(() => "?").join(", ");
  type R = RowDataPacket & {
    part_id: string;
    completed_at: Date | null;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      CAST(upp.part_id AS CHAR) AS part_id,
      upp.completed_at AS completed_at
    FROM user_part_progress upp
    INNER JOIN part_catalog pc ON pc.part_id COLLATE utf8mb4_unicode_ci = upp.part_id
    WHERE upp.user_id = ?
      AND pc.video_id COLLATE utf8mb4_unicode_ci IN (${ph})
    `,
    [userId, ...videoIds] as SqlReadScalar[],
  );
  return rows.map((r) => ({
    partId: String(r.part_id),
    completedAt: r.completed_at,
  }));
}

export async function listUserVideoLastSeenForVideos(
  userId: UserId,
  videoIds: string[],
): Promise<Array<{ videoId: string; episodeId: string | null }>> {
  if (videoIds.length === 0) return [];
  const ph = videoIds.map(() => "?").join(", ");
  type R = RowDataPacket & {
    video_id: string;
    episode_id: string | null;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      CAST(video_id AS CHAR) AS video_id,
      CAST(episode_id AS CHAR) AS episode_id
    FROM user_video_last_seen
    WHERE user_id = ? AND video_id IN (${ph})
    `,
    [userId, ...videoIds] as SqlReadScalar[],
  );
  return rows.map((r) => ({
    videoId: String(r.video_id),
    episodeId: r.episode_id != null ? String(r.episode_id) : null,
  }));
}

export async function listUserDailyLearningTimeBetweenDayKeys(
  userId: UserId,
  dayKeyGte: string,
  dayKeyLte: string,
): Promise<Array<{ dayKey: string; learningTimeMs: number }>> {
  type R = RowDataPacket & {
    day_key: string;
    learning_time_ms: number;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT day_key, learning_time_ms
    FROM user_daily_learning_time
    WHERE user_id = ? AND day_key >= ? AND day_key <= ?
    `,
    [userId, dayKeyGte, dayKeyLte] as SqlReadScalar[],
  );
  return rows.map((r) => ({
    dayKey: String(r.day_key),
    learningTimeMs: Number(r.learning_time_ms),
  }));
}
