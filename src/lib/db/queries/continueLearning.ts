import type { UserId } from "@/types/schema";
/**
 * Rows for `/` continue-learning cards (mysql2 reads).
 */
import { pool } from "@/lib/db/connection";
import {
  JOIN_EPISODE_ON_CATALOG,
  JOIN_VIDEO_ON_CATALOG,
  USER_PROGRESS_JOIN_PART_CATALOG,
} from "@/lib/db/sql/partCatalog";
import type { VideoType } from "@/types/video";
import type { RowDataPacket } from "mysql2/promise";

type SqlReadScalar = string | number | boolean | Date | bigint | Buffer | null;

/** mysql2 prepared statements reject bound LIMIT placeholders on some servers. */
function sqlLimit(take: number): number {
  const n = Math.trunc(Number(take));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 100);
}

export type ContinueProgressPartRow = {
  partId: string;
  order: number;
  partEpisodeId: string | null;
  episodeTitle: string | null;
  episodeNum: number | null;
  seasonId: string | null;
  seasonNum: number | null;
  seasonVideoId: string | null;
  rootVideoType: VideoType;
  rootVideoId: string;
  rootVideoName: string;
  rootCoverUrl: string | null;
  completedAt: Date | null;
  bestScore: number;
};

export async function listRecentContinueProgressParts(
  userId: UserId,
  take: number,
): Promise<ContinueProgressPartRow[]> {
  type R = RowDataPacket & {
    part_id: string;
    part_order: number;
    part_episode_id: string | null;
    episode_title: string | null;
    episode_num: number | null;
    season_id: string | null;
    season_num: number | null;
    season_video_id: string | null;
    root_video_type: string;
    root_video_id: string;
    root_video_name: string;
    root_cover_url: string | null;
    completed_at: Date | null;
    best_score: number;
  };
  const lim = sqlLimit(take);
  const query = `
    SELECT
      CAST(p.id AS CHAR) AS part_id,
      p.\`order\` AS part_order,
      pc.episode_id AS part_episode_id,
      e.title AS episode_title,
      pc.episode_num AS episode_num,
      pc.season_id AS season_id,
      pc.season_num AS season_num,
      pc.video_id AS season_video_id,
      pc.video_type AS root_video_type,
      pc.video_id AS root_video_id,
      pc.video_name AS root_video_name,
      v.cover_url AS root_cover_url,
      upp.completed_at AS completed_at,
      upp.best_score AS best_score
    FROM user_part_progress upp
    INNER JOIN parts p ON p.id = upp.part_id
    ${USER_PROGRESS_JOIN_PART_CATALOG}
    INNER JOIN videos v ON ${JOIN_VIDEO_ON_CATALOG("pc", "v")}
    LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
    WHERE upp.user_id = ?
    ORDER BY upp.last_attempt_at DESC
    LIMIT 1
  `;
  const [rows] = await pool.execute<R[]>(query, [userId] as SqlReadScalar[]);

  return rows.map((r) => ({
    partId: String(r.part_id),
    order: Number(r.part_order),
    partEpisodeId: r.part_episode_id != null ? String(r.part_episode_id) : null,
    episodeTitle:
      r.episode_title != null && r.episode_title !== ""
        ? String(r.episode_title)
        : null,
    episodeNum:
      r.episode_num !== null && r.episode_num !== undefined
        ? Number(r.episode_num)
        : null,
    seasonId: r.season_id != null ? String(r.season_id) : null,
    seasonNum:
      r.season_num !== null && r.season_num !== undefined
        ? Number(r.season_num)
        : null,
    seasonVideoId: r.season_video_id != null ? String(r.season_video_id) : null,
    rootVideoType: r.root_video_type as VideoType,
    rootVideoId: String(r.root_video_id),
    rootVideoName: String(r.root_video_name),
    rootCoverUrl: r.root_cover_url != null ? String(r.root_cover_url) : null,
    completedAt: r.completed_at ?? null,
    bestScore: Number(r.best_score),
  }));
}
