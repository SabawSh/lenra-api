import type { UserId } from "@/types/schema";
/**
 * `user_learning_resume` — Continue Learning journey pointer.
 * Only advanced by real progression; independent of UI last-seen bookmarks.
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

export type UserLearningResumeRecord = {
  id: number;
  userId: UserId;
  videoId: string;
  seasonId: string | null;
  episodeId: string | null;
  resumeSection: number;
  resumePart: number;
  highestUnlockedSection: number;
  createdAt: Date;
  updatedAt: Date;
};

function mapRow(row: Record<string, unknown>): UserLearningResumeRecord {
  return {
    id: Number(row.id),
    userId: String(row.user_id),
    videoId: String(row.video_id),
    seasonId: row.season_id != null ? String(row.season_id) : null,
    episodeId: row.episode_id != null ? String(row.episode_id) : null,
    resumeSection: Number(row.resume_section),
    resumePart: Number(row.resume_part),
    highestUnlockedSection: Number(row.highest_unlocked_section),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export async function findLearningResumeForVideo(
  userId: UserId,
  videoId: string,
): Promise<UserLearningResumeRecord | null> {
  type R = RowDataPacket & Record<string, unknown>;
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      id,
      user_id,
      CAST(video_id AS CHAR) AS video_id,
      CAST(season_id AS CHAR) AS season_id,
      CAST(episode_id AS CHAR) AS episode_id,
      resume_section,
      resume_part,
      highest_unlocked_section,
      created_at,
      updated_at
    FROM user_learning_resume
    WHERE user_id = ? AND video_id = ?
    LIMIT 1
    `,
    [userId, videoId],
  );
  const r = rows[0];
  return r ? mapRow(r) : null;
}

/** Most recently advanced journey pointer for Continue Learning. */
export async function findLatestLearningResume(
  userId: UserId,
): Promise<UserLearningResumeRecord | null> {
  type R = RowDataPacket & Record<string, unknown>;
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      id,
      user_id,
      CAST(video_id AS CHAR) AS video_id,
      CAST(season_id AS CHAR) AS season_id,
      CAST(episode_id AS CHAR) AS episode_id,
      resume_section,
      resume_part,
      highest_unlocked_section,
      created_at,
      updated_at
    FROM user_learning_resume
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [userId],
  );
  const r = rows[0];
  return r ? mapRow(r) : null;
}

export type UpsertLearningResumeParams = {
  userId: UserId;
  videoId: string;
  seasonId: string | null;
  episodeId: string | null;
  resumeSection: number;
  resumePart: number;
  highestUnlockedSection: number;
};

/** Unconditional write — callers must apply forward-only / unlock rules first. */
export async function upsertLearningResume(
  params: UpsertLearningResumeParams,
): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `
    INSERT INTO user_learning_resume (
      user_id,
      video_id,
      season_id,
      episode_id,
      resume_section,
      resume_part,
      highest_unlocked_section
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      season_id = VALUES(season_id),
      episode_id = VALUES(episode_id),
      resume_section = VALUES(resume_section),
      resume_part = VALUES(resume_part),
      highest_unlocked_section = VALUES(highest_unlocked_section),
      updated_at = CURRENT_TIMESTAMP(3)
    `,
    [
      params.userId,
      params.videoId,
      params.seasonId,
      params.episodeId,
      params.resumeSection,
      params.resumePart,
      params.highestUnlockedSection,
    ] as SqlScalar[],
  );
}
