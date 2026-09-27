import type { UserId } from "@/types/schema";
/**
 * `user_video_last_seen` — optional UI bookmarks (unique per user + video).
 * Not authoritative for learning progression (see `user_part_progress`).
 */
import { pool } from "@/lib/db/connection";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

type SqlScalar =
  | string
  | number
  | boolean
  | Date
  | bigint
  | Buffer
  | null;

export type UserVideoLastSeenRecord = {
  id: number;
  userId: UserId;
  videoId: string;
  seasonId: string | null;
  episodeId: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
};

function mapRow(row: Record<string, unknown>): UserVideoLastSeenRecord {
  return {
    id: Number(row.id),
    userId: String(row.user_id),
    videoId: String(row.video_id),
    seasonId: row.season_id != null ? String(row.season_id) : null,
    episodeId: row.episode_id != null ? String(row.episode_id) : null,
    order: Number(row.order /* column is `order` in SQL */),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

/** Note: mysql2 may return `order` as reserved — selected with alias. */
export async function upsertUserVideoLastSeen(params: {
  userId: UserId;
  videoId: string;
  order: number;
  seasonId: string | null;
  episodeId: string | null;
}): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `
    INSERT INTO user_video_last_seen (
      user_id, video_id, \`order\`, season_id, episode_id
    ) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      \`order\` = VALUES(\`order\`),
      season_id = VALUES(season_id),
      episode_id = VALUES(episode_id),
      updated_at = CURRENT_TIMESTAMP(3)
    `,
    [
      params.userId,
      params.videoId,
      params.order,
      params.seasonId,
      params.episodeId,
    ] as SqlScalar[],
  );
}

export async function listUserVideoLastSeenForUser(
  userId: UserId,
): Promise<UserVideoLastSeenRecord[]> {
  type R = RowDataPacket &
    Record<string, unknown> & { part_order: number };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      id,
      user_id,
      CAST(video_id AS CHAR) AS video_id,
      CAST(season_id AS CHAR) AS season_id,
      CAST(episode_id AS CHAR) AS episode_id,
      \`order\` AS part_order,
      created_at,
      updated_at
    FROM user_video_last_seen
    WHERE user_id = ?
    ORDER BY updated_at DESC
    `,
    [userId],
  );
  return rows.map((r) =>
    mapRow({
      ...r,
      order: r.part_order,
    } as Record<string, unknown>),
  );
}

export async function findUserVideoLastSeenForSeason(
  userId: UserId,
  videoId: string,
  seasonId: string,
): Promise<UserVideoLastSeenRecord | null> {
  type R = RowDataPacket &
    Record<string, unknown> & { part_order: number };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      id,
      user_id,
      CAST(video_id AS CHAR) AS video_id,
      CAST(season_id AS CHAR) AS season_id,
      CAST(episode_id AS CHAR) AS episode_id,
      \`order\` AS part_order,
      created_at,
      updated_at
    FROM user_video_last_seen
    WHERE user_id = ? AND video_id = ? AND season_id <=> ?
    LIMIT 1
    `,
    [userId, videoId, seasonId],
  );
  const r = rows[0];
  if (!r) return null;
  return mapRow({ ...r, order: r.part_order } as Record<string, unknown>);
}

export async function findUserVideoLastSeenForEpisode(
  userId: UserId,
  videoId: string,
  episodeId: string,
): Promise<UserVideoLastSeenRecord | null> {
  type R = RowDataPacket &
    Record<string, unknown> & { part_order: number };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      id,
      user_id,
      CAST(video_id AS CHAR) AS video_id,
      CAST(season_id AS CHAR) AS season_id,
      CAST(episode_id AS CHAR) AS episode_id,
      \`order\` AS part_order,
      created_at,
      updated_at
    FROM user_video_last_seen
    WHERE user_id = ? AND video_id = ? AND episode_id <=> ?
    LIMIT 1
    `,
    [userId, videoId, episodeId],
  );
  const r = rows[0];
  if (!r) return null;
  return mapRow({ ...r, order: r.part_order } as Record<string, unknown>);
}

/** Resume bookmark for a standalone title (movie / documentary). */
export async function findUserVideoLastSeenForStandalone(
  userId: UserId,
  videoId: string,
): Promise<UserVideoLastSeenRecord | null> {
  type R = RowDataPacket &
    Record<string, unknown> & { part_order: number };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      id,
      user_id,
      CAST(video_id AS CHAR) AS video_id,
      CAST(season_id AS CHAR) AS season_id,
      CAST(episode_id AS CHAR) AS episode_id,
      \`order\` AS part_order,
      created_at,
      updated_at
    FROM user_video_last_seen
    WHERE user_id = ? AND video_id = ? AND season_id IS NULL AND episode_id IS NULL
    LIMIT 1
    `,
    [userId, videoId],
  );
  const r = rows[0];
  if (!r) return null;
  return mapRow({ ...r, order: r.part_order } as Record<string, unknown>);
}

/** Latest bookmark for a title (any season/episode). */
export async function findUserVideoLastSeenForVideo(
  userId: UserId,
  videoId: string,
): Promise<UserVideoLastSeenRecord | null> {
  type R = RowDataPacket &
    Record<string, unknown> & { part_order: number };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      id,
      user_id,
      CAST(video_id AS CHAR) AS video_id,
      CAST(season_id AS CHAR) AS season_id,
      CAST(episode_id AS CHAR) AS episode_id,
      \`order\` AS part_order,
      created_at,
      updated_at
    FROM user_video_last_seen
    WHERE user_id = ? AND video_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [userId, videoId],
  );
  const r = rows[0];
  if (!r) return null;
  return mapRow({ ...r, order: r.part_order } as Record<string, unknown>);
}
