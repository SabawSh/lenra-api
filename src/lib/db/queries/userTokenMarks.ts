import { pool } from "@/lib/db/connection";
import type { RowDataPacket } from "mysql2/promise";
import type { VideoType } from "@/types/video";

import type { UserId } from "@/types/schema";
export type WeakMarkRowRaw = {
  type: string;
  partId: string;
  partOrder: number;
  text: string | null;
  partEpisodeId: string | null;
  svType: VideoType | null;
  seasonId: string | null;
  seasonVideoId: string | null;
};

export async function listWeakTokenMarksWithPartJoin(
  userId: UserId,
  take: number,
): Promise<WeakMarkRowRaw[]> {
  const lim = Math.min(Math.max(take, 1), 200);
  type R = RowDataPacket & {
    mark_type: string;
    pid: string;
    part_order: number;
    text: string | null;
    part_episode_id: string | null;
    sv_type: string | null;
    season_id: string | null;
    season_video_id: string | null;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      utm.type AS mark_type,
      CAST(p.id AS CHAR) AS pid,
      p.\`order\` AS part_order,
      p.text AS text,
      pc.episode_id AS part_episode_id,
      pc.video_type AS sv_type,
      pc.season_id AS season_id,
      pc.video_id AS season_video_id
    FROM user_token_marks utm
    INNER JOIN part_catalog pc ON pc.part_id COLLATE utf8mb4_unicode_ci = utm.part_id
    INNER JOIN parts p ON p.id = utm.part_id
    WHERE utm.user_id = ?
      AND utm.type IN ('unknown', 'confused')
    ORDER BY utm.created_at DESC
    LIMIT ${lim}
    `,
    [userId],
  );
  return rows.map((r) => ({
    type: String(r.mark_type),
    partId: String(r.pid),
    partOrder: Number(r.part_order),
    text: r.text != null ? String(r.text) : null,
    partEpisodeId: r.part_episode_id != null ? String(r.part_episode_id) : null,
    svType: r.sv_type != null ? (r.sv_type as VideoType) : null,
    seasonId: r.season_id != null ? String(r.season_id) : null,
    seasonVideoId:
      r.season_video_id != null ? String(r.season_video_id) : null,
  }));
}
