import type { UserId } from "@/types/schema";
/**
 * Canonical part progression lookups (user_part_progress + part_catalog).
 */
import { pool } from "@/lib/db/connection";
import {
  JOIN_EPISODE_ON_CATALOG,
  PART_JOIN_PART_CATALOG,
  USER_PROGRESS_JOIN_PART_CATALOG,
} from "@/lib/db/sql/partCatalog";

const UC = "utf8mb4_unicode_ci";
import type {
  PartCatalogAnchor,
  PartCatalogAnchorBare,
} from "@/lib/learning/partProgression";
import type { VideoType } from "@/types/video";
import type { RowDataPacket } from "mysql2/promise";

type SqlScalar =
  | string
  | number
  | boolean
  | Date
  | bigint
  | Buffer
  | null;

type CatalogRow = RowDataPacket & {
  part_id: string;
  part_order: number;
  episode_id: string;
  season_id: string;
  video_id: string;
  video_type: string;
  video_name: string;
  season_num: number;
  episode_num: number;
  episode_title: string | null;
  completed_at: Date | null;
  best_score: number | null;
  last_attempt_at: Date | null;
};

function mapCatalogRow(r: CatalogRow): PartCatalogAnchor {
  return {
    partId: String(r.part_id),
    order: Number(r.part_order),
    episodeId: String(r.episode_id),
    seasonId: String(r.season_id),
    videoId: String(r.video_id),
    videoType: r.video_type as VideoType,
    videoName: String(r.video_name),
    seasonNum: Number(r.season_num),
    episodeNum: Number(r.episode_num),
    episodeTitle:
      r.episode_title != null && r.episode_title !== ""
        ? String(r.episode_title)
        : null,
    completedAt: r.completed_at ?? null,
    bestScore: r.best_score != null ? Number(r.best_score) : 0,
    lastAttemptAt: r.last_attempt_at ?? null,
  };
}

const CATALOG_SELECT = `
  CAST(p.id AS CHAR) AS part_id,
  p.\`order\` AS part_order,
  CAST(pc.episode_id AS CHAR) AS episode_id,
  CAST(pc.season_id AS CHAR) AS season_id,
  CAST(pc.video_id AS CHAR) AS video_id,
  pc.video_type AS video_type,
  pc.video_name AS video_name,
  pc.season_num AS season_num,
  pc.episode_num AS episode_num,
  e.title AS episode_title
`;

const READY_PART_FILTER = `p.processing_status = 'ready'`;

/** Next playable part in global video order after the anchor. */
export async function fetchNextSequentialPartAfter(
  anchor: Pick<
    PartCatalogAnchorBare,
    "videoId" | "seasonNum" | "episodeNum" | "order"
  >,
): Promise<PartCatalogAnchorBare | null> {
  const [rows] = await pool.execute<CatalogRow[]>(
    `
    SELECT
      ${CATALOG_SELECT}
    FROM parts p
    ${PART_JOIN_PART_CATALOG}
    LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
    INNER JOIN seasons s ON s.id = pc.season_id
    WHERE pc.video_id COLLATE ${UC} = ?
      AND ${READY_PART_FILTER}
      AND (
        s.season_num > ?
        OR (s.season_num = ? AND e.episode_num > ?)
        OR (s.season_num = ? AND e.episode_num = ? AND p.\`order\` > ?)
      )
    ORDER BY s.season_num ASC, e.episode_num ASC, p.\`order\` ASC
    LIMIT 1
    `,
    [
      anchor.videoId,
      anchor.seasonNum,
      anchor.seasonNum,
      anchor.episodeNum,
      anchor.seasonNum,
      anchor.episodeNum,
      anchor.order,
    ] as SqlScalar[],
  );
  const r = rows[0];
  if (!r) return null;
  return toBareAnchor(mapCatalogRow(r));
}

function toBareAnchor(anchor: PartCatalogAnchor): PartCatalogAnchorBare {
  const { completedAt: _c, bestScore: _b, lastAttemptAt: _l, ...bare } =
    anchor;
  return bare;
}

/** Next part within the same episode only (section map resume). */
export async function fetchNextSequentialPartInEpisodeAfter(
  episodeId: string,
  afterOrder: number,
): Promise<PartCatalogAnchorBare | null> {
  const [rows] = await pool.execute<CatalogRow[]>(
    `
    SELECT
      ${CATALOG_SELECT}
    FROM parts p
    ${PART_JOIN_PART_CATALOG}
    LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
    WHERE pc.episode_id COLLATE ${UC} = ?
      AND p.\`order\` > ?
      AND ${READY_PART_FILTER}
    ORDER BY p.\`order\` ASC
    LIMIT 1
    `,
    [episodeId, afterOrder] as SqlScalar[],
  );
  const r = rows[0];
  if (!r) return null;
  return toBareAnchor(mapCatalogRow(r));
}

export async function fetchPartCatalogAnchorByPartId(
  partId: string,
): Promise<PartCatalogAnchorBare | null> {
  const [rows] = await pool.execute<CatalogRow[]>(
    `
    SELECT
      ${CATALOG_SELECT}
    FROM parts p
    ${PART_JOIN_PART_CATALOG}
    LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
    WHERE p.id = ?
    LIMIT 1
    `,
    [partId],
  );
  const r = rows[0];
  if (!r) return null;
  return toBareAnchor(mapCatalogRow(r));
}

export async function fetchLatestPartProgressAnchorForUser(
  userId: UserId,
): Promise<PartCatalogAnchor | null> {
  const [rows] = await pool.execute<CatalogRow[]>(
    `
    SELECT
      ${CATALOG_SELECT},
      upp.completed_at AS completed_at,
      upp.best_score AS best_score,
      upp.last_attempt_at AS last_attempt_at
    FROM user_part_progress upp
    INNER JOIN parts p ON p.id = upp.part_id
    ${USER_PROGRESS_JOIN_PART_CATALOG}
    LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
    WHERE upp.user_id = ?
    ORDER BY upp.last_attempt_at DESC
    LIMIT 1
    `,
    [userId],
  );
  const r = rows[0];
  return r ? mapCatalogRow(r) : null;
}

export async function fetchLatestPartProgressAnchorForEpisode(
  userId: UserId,
  episodeId: string,
): Promise<PartCatalogAnchor | null> {
  const [rows] = await pool.execute<CatalogRow[]>(
    `
    SELECT
      ${CATALOG_SELECT},
      upp.completed_at AS completed_at,
      upp.best_score AS best_score,
      upp.last_attempt_at AS last_attempt_at
    FROM user_part_progress upp
    INNER JOIN parts p ON p.id = upp.part_id
    ${USER_PROGRESS_JOIN_PART_CATALOG}
    LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
    WHERE upp.user_id = ? AND pc.episode_id COLLATE ${UC} = ?
    ORDER BY upp.last_attempt_at DESC
    LIMIT 1
    `,
    [userId, episodeId],
  );
  const r = rows[0];
  return r ? mapCatalogRow(r) : null;
}

export async function fetchLatestPartProgressAnchorForVideo(
  userId: UserId,
  videoId: string,
): Promise<PartCatalogAnchor | null> {
  const [rows] = await pool.execute<CatalogRow[]>(
    `
    SELECT
      ${CATALOG_SELECT},
      upp.completed_at AS completed_at,
      upp.best_score AS best_score,
      upp.last_attempt_at AS last_attempt_at
    FROM user_part_progress upp
    INNER JOIN parts p ON p.id = upp.part_id
    ${USER_PROGRESS_JOIN_PART_CATALOG}
    LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
    WHERE upp.user_id = ? AND pc.video_id COLLATE ${UC} = ?
    ORDER BY upp.last_attempt_at DESC
    LIMIT 1
    `,
    [userId, videoId],
  );
  const r = rows[0];
  return r ? mapCatalogRow(r) : null;
}

/** First ready part in catalog order the user has not completed. */
export async function fetchFirstIncompletePartAnchorForUserVideo(
  userId: UserId,
  videoId: string,
): Promise<PartCatalogAnchorBare | null> {
  const [rows] = await pool.execute<CatalogRow[]>(
    `
    SELECT
      ${CATALOG_SELECT}
    FROM parts p
    ${PART_JOIN_PART_CATALOG}
    LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
    INNER JOIN seasons s ON s.id = pc.season_id
    LEFT JOIN user_part_progress upp
      ON upp.part_id = p.id AND upp.user_id = ?
    WHERE pc.video_id COLLATE ${UC} = ?
      AND ${READY_PART_FILTER}
      AND NOT (
        upp.completed_at IS NOT NULL
        OR COALESCE(upp.best_score, 0) > 0
      )
    ORDER BY s.season_num ASC, e.episode_num ASC, p.\`order\` ASC
    LIMIT 1
    `,
    [userId, videoId] as SqlScalar[],
  );
  const r = rows[0];
  if (!r) return null;
  return toBareAnchor(mapCatalogRow(r));
}

/** Furthest finished part in catalog order for a title. */
export async function fetchLatestCompletedPartAnchorForUserVideo(
  userId: UserId,
  videoId: string,
): Promise<PartCatalogAnchorBare | null> {
  const [rows] = await pool.execute<CatalogRow[]>(
    `
    SELECT
      ${CATALOG_SELECT}
    FROM user_part_progress upp
    INNER JOIN parts p ON p.id = upp.part_id
    ${USER_PROGRESS_JOIN_PART_CATALOG}
    LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
    INNER JOIN seasons s ON s.id = pc.season_id
    WHERE upp.user_id = ?
      AND pc.video_id COLLATE ${UC} = ?
      AND (upp.completed_at IS NOT NULL OR upp.best_score > 0)
    ORDER BY s.season_num DESC, e.episode_num DESC, p.\`order\` DESC
    LIMIT 1
    `,
    [userId, videoId] as SqlScalar[],
  );
  const r = rows[0];
  if (!r) return null;
  return toBareAnchor(mapCatalogRow(r));
}

/** First ready part in catalog order (no progress required). */
export async function fetchFirstPartAnchorForVideo(
  videoId: string,
): Promise<PartCatalogAnchorBare | null> {
  const [rows] = await pool.execute<CatalogRow[]>(
    `
    SELECT
      ${CATALOG_SELECT}
    FROM parts p
    ${PART_JOIN_PART_CATALOG}
    LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
    INNER JOIN seasons s ON s.id = pc.season_id
    WHERE pc.video_id COLLATE ${UC} = ?
      AND ${READY_PART_FILTER}
    ORDER BY s.season_num ASC, e.episode_num ASC, p.\`order\` ASC
    LIMIT 1
    `,
    [videoId] as SqlScalar[],
  );
  const r = rows[0];
  if (!r) return null;
  return toBareAnchor(mapCatalogRow(r));
}

export type HistoryProgressRow = {
  videoId: string;
  order: number;
  videoType: VideoType;
  seasonId: string;
  episodeId: string;
  updatedAt: Date;
  videoName: string;
};

/** Distinct videos/episodes the user recently practiced (for history continue). */
export async function listRecentHistoryProgressAnchors(
  userId: UserId,
  limit: number,
): Promise<HistoryProgressRow[]> {
  const lim = Math.min(Math.max(1, Math.trunc(limit)), 100);
  type R = RowDataPacket & {
    video_id: string;
    part_order: number;
    video_type: string;
    season_id: string;
    episode_id: string;
    last_attempt_at: Date;
    video_name: string;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      CAST(pc.video_id AS CHAR) AS video_id,
      p.\`order\` AS part_order,
      pc.video_type AS video_type,
      CAST(pc.season_id AS CHAR) AS season_id,
      CAST(pc.episode_id AS CHAR) AS episode_id,
      upp.last_attempt_at AS last_attempt_at,
      pc.video_name AS video_name
    FROM user_part_progress upp
    INNER JOIN parts p ON p.id = upp.part_id
    ${USER_PROGRESS_JOIN_PART_CATALOG}
    WHERE upp.user_id = ?
    ORDER BY upp.last_attempt_at DESC
    LIMIT ${lim * 4}
    `,
    [userId],
  );

  const out: HistoryProgressRow[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const episodeId = String(r.episode_id);
    const key = `ep:${episodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      videoId: String(r.video_id),
      order: Number(r.part_order),
      videoType: r.video_type as VideoType,
      seasonId: String(r.season_id),
      episodeId,
      updatedAt: r.last_attempt_at,
      videoName: String(r.video_name),
    });
    if (out.length >= lim) break;
  }

  return out;
}

/** Latest practiced episode per series video (replaces last-seen episode scope). */
export async function listLatestProgressEpisodeByVideo(
  userId: UserId,
  videoIds: string[],
): Promise<Array<{ videoId: string; episodeId: string }>> {
  if (videoIds.length === 0) return [];
  const ph = videoIds.map(() => "?").join(", ");
  type R = RowDataPacket & {
    video_id: string;
    episode_id: string;
    last_attempt_at: Date;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      CAST(pc.video_id AS CHAR) AS video_id,
      CAST(pc.episode_id AS CHAR) AS episode_id,
      upp.last_attempt_at AS last_attempt_at
    FROM user_part_progress upp
    INNER JOIN parts p ON p.id = upp.part_id
    ${USER_PROGRESS_JOIN_PART_CATALOG}
    WHERE upp.user_id = ?
      AND pc.video_id IN (${ph})
    ORDER BY upp.last_attempt_at DESC
    `,
    [userId, ...videoIds] as SqlScalar[],
  );

  const byVideo = new Map<string, string>();
  for (const r of rows) {
    const vid = String(r.video_id);
    if (!byVideo.has(vid)) {
      byVideo.set(vid, String(r.episode_id));
    }
  }
  return [...byVideo.entries()].map(([videoId, episodeId]) => ({
    videoId,
    episodeId,
  }));
}
