import type { UserId } from "@/types/schema";
/**
 * CRUD / lists for `saved_vocabulary_cards` (snake_case DDL).
 */
import { pool } from "@/lib/db/connection";
import {
  JOIN_EPISODE_ON_CATALOG,
  JOIN_VIDEO_ON_CATALOG,
  VOCAB_CLIP_JOIN_PART_CATALOG,
} from "@/lib/db/sql/partCatalog";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

type SqlScalar =
  | string
  | number
  | boolean
  | Date
  | bigint
  | Buffer
  | null;

export type SavedVocabularyCardCamel = {
  id: number;
  userId: UserId;
  word: string;
  normalizedWord: string;
  sentence: string;
  translation: string | null;
  movieTitle: string;
  subtitleStartTime: number | null;
  subtitleEndTime: number | null;
  previewImage: string | null;
  reviewStrength: number;
  nextReviewAt: Date;
  lastReviewedAt: Date | null;
  reviewCount: number;
  createdAt: Date;
  updatedAt: Date;
  clipId: string;
  episodeId: string | null;
  seasonId: string | null;
};

function mapCamel(
  row: Record<string, unknown>,
): SavedVocabularyCardCamel {
  return {
    id: Number(row.id),
    userId: String(row.user_id),
    word: String(row.word),
    normalizedWord: String(row.normalized_word),
    sentence: String(row.sentence),
    translation: row.translation != null ? String(row.translation) : null,
    movieTitle:
      row.movie_title != null && String(row.movie_title) !== ""
        ? String(row.movie_title)
        : "",
    subtitleStartTime:
      row.subtitle_start_time != null
        ? Number(row.subtitle_start_time)
        : null,
    subtitleEndTime:
      row.subtitle_end_time != null ? Number(row.subtitle_end_time) : null,
    previewImage:
      row.preview_image != null ? String(row.preview_image) : null,
    reviewStrength: Number(row.review_strength),
    nextReviewAt: row.next_review_at as Date,
    lastReviewedAt:
      row.last_reviewed_at != null ? (row.last_reviewed_at as Date) : null,
    reviewCount: Number(row.review_count),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    clipId: String(row.clip_id),
    episodeId:
      row.episode_id != null ? String(row.episode_id) : null,
    seasonId: row.season_id != null ? String(row.season_id) : null,
  };
}

export type ListedSavedCardRow = {
  card: SavedVocabularyCardCamel;
  clipUrl: string;
  clipHlsManifestUrl: string | null;
  clipDurationMs: number;
  episodeTitle: string | null;
  episodeNum: number | null;
  seasonNum: number | null;
  epCoverUrl: string | null;
  seasonCoverUrl: string | null;
  seriesVideoCoverUrl: string | null;
  directVideoCoverUrl: string | null;
  seriesVideoName: string | null;
  directVideoName: string | null;
};

export async function listSavedVocabularyJoinedForUser(
  userId: UserId,
): Promise<ListedSavedCardRow[]> {
  type R = RowDataPacket &
    Record<string, unknown> & {
      clip_url: string;
      clip_hls_manifest_url: string | null;
      clip_duration_ms: number;
      ep_title: string | null;
      ep_num: number | null;
      ss_num: number | null;
      ep_cover_url: string | null;
      ss_cover_url: string | null;
      series_video_cover_url: string | null;
      direct_video_cover_url: string | null;
      series_video_name: string | null;
      direct_video_name: string | null;
    };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      svc.id,
      svc.user_id,
      svc.word,
      svc.normalized_word,
      svc.sentence,
      svc.translation,
      pc.video_name AS movie_title,
      svc.subtitle_start_time,
      svc.subtitle_end_time,
      svc.preview_image,
      svc.review_strength,
      svc.next_review_at,
      svc.last_reviewed_at,
      svc.review_count,
      svc.created_at,
      svc.updated_at,
      CAST(svc.clip_id AS CHAR) AS clip_id,
      CAST(svc.episode_id AS CHAR) AS episode_id,
      CAST(svc.season_id AS CHAR) AS season_id,
      p.video_url AS clip_url,
      p.hls_manifest_url AS clip_hls_manifest_url,
      p.duration_ms AS clip_duration_ms,
      e.title AS ep_title,
      pc.episode_num AS ep_num,
      pc.season_num AS ss_num,
      e.cover_url AS ep_cover_url,
      s.cover_url AS ss_cover_url,
      v.cover_url AS series_video_cover_url,
      CASE WHEN pc.video_type IN ('movie', 'documentary') THEN v.cover_url ELSE NULL END AS direct_video_cover_url,
      CASE WHEN pc.video_type = 'series' THEN pc.video_name ELSE NULL END AS series_video_name,
      CASE WHEN pc.video_type IN ('movie', 'documentary') THEN pc.video_name ELSE NULL END AS direct_video_name
    FROM saved_vocabulary_cards svc
    ${VOCAB_CLIP_JOIN_PART_CATALOG}
    INNER JOIN videos v ON ${JOIN_VIDEO_ON_CATALOG("pc", "v")}
    LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
    LEFT JOIN seasons s ON s.id = pc.season_id
    WHERE svc.user_id = ?
    ORDER BY svc.created_at DESC
    `,
    [userId],
  );
  return rows.map((r) => ({
    card: mapCamel(r as Record<string, unknown>),
    clipUrl: String(r.clip_url),
    clipHlsManifestUrl:
      r.clip_hls_manifest_url != null &&
      String(r.clip_hls_manifest_url).trim() !== ""
        ? String(r.clip_hls_manifest_url)
        : null,
    clipDurationMs: Number(r.clip_duration_ms),
    episodeTitle: r.ep_title != null ? String(r.ep_title) : null,
    episodeNum: r.ep_num != null ? Number(r.ep_num) : null,
    seasonNum: r.ss_num != null ? Number(r.ss_num) : null,
    epCoverUrl:
      r.ep_cover_url != null ? String(r.ep_cover_url) : null,
    seasonCoverUrl:
      r.ss_cover_url != null ? String(r.ss_cover_url) : null,
    seriesVideoCoverUrl:
      r.series_video_cover_url != null
        ? String(r.series_video_cover_url)
        : null,
    directVideoCoverUrl:
      r.direct_video_cover_url != null
        ? String(r.direct_video_cover_url)
        : null,
    seriesVideoName:
      r.series_video_name != null ? String(r.series_video_name) : null,
    directVideoName:
      r.direct_video_name != null ? String(r.direct_video_name) : null,
  }));
}

export async function upsertSavedVocabularyCard(params: {
  userId: UserId;
  word: string;
  normalizedWord: string;
  sentence: string;
  translation: string | null;
  clipId: string;
  episodeId: string | null;
  seasonId: string | null;
  subtitleStartTime: number | null;
  subtitleEndTime: number | null;
  previewImage: string | null;
  nextReviewAtOnInsert: Date;
}): Promise<SavedVocabularyCardCamel> {
  await pool.execute<ResultSetHeader>(
    `
    INSERT INTO saved_vocabulary_cards (
      user_id,
      word,
      normalized_word,
      sentence,
      translation,
      clip_id,
      episode_id,
      season_id,
      subtitle_start_time,
      subtitle_end_time,
      preview_image,
      next_review_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      word = VALUES(word),
      sentence = VALUES(sentence),
      translation = VALUES(translation),
      episode_id = VALUES(episode_id),
      season_id = VALUES(season_id),
      subtitle_start_time = VALUES(subtitle_start_time),
      subtitle_end_time = VALUES(subtitle_end_time),
      preview_image = VALUES(preview_image),
      updated_at = CURRENT_TIMESTAMP(3)
    `,
    [
      params.userId,
      params.word,
      params.normalizedWord,
      params.sentence,
      params.translation,
      params.clipId,
      params.episodeId,
      params.seasonId,
      params.subtitleStartTime,
      params.subtitleEndTime,
      params.previewImage,
      params.nextReviewAtOnInsert,
    ] as SqlScalar[],
  );
  const row = await fetchSavedCardByUserClipNormalized(
    params.userId,
    params.clipId,
    params.normalizedWord,
  );
  if (!row) throw new Error("upsertSavedVocabularyCard: row missing");
  return row;
}

async function fetchSavedCardByUserClipNormalized(
  userId: UserId,
  clipId: string,
  normalizedWord: string,
): Promise<SavedVocabularyCardCamel | null> {
  const [rows] = await pool.execute<(RowDataPacket & Record<string, unknown>)[]>(
    `
    SELECT
      svc.*,
      pc.video_name AS movie_title
    FROM saved_vocabulary_cards svc
    ${VOCAB_CLIP_JOIN_PART_CATALOG}
    WHERE svc.user_id = ? AND svc.clip_id = ? AND svc.normalized_word = ?
    LIMIT 1
    `,
    [userId, clipId, normalizedWord],
  );
  const r = rows[0];
  return r ? mapCamel(r as Record<string, unknown>) : null;
}

export async function fetchReviewStrengthForUserCard(
  cardId: number,
  userId: UserId,
): Promise<number | null> {
  type R = RowDataPacket & { review_strength: number };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT review_strength FROM saved_vocabulary_cards
    WHERE id = ? AND user_id = ?
    LIMIT 1
    `,
    [cardId, userId],
  );
  const r = rows[0];
  return r ? Number(r.review_strength) : null;
}

export async function updateSavedCardAfterReview(params: {
  cardId: number;
  userId: UserId;
  reviewStrength: number;
  nextReviewAt: Date;
  lastReviewedAt: Date;
}): Promise<SavedVocabularyCardCamel | null> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `
    UPDATE saved_vocabulary_cards
    SET
      review_strength = ?,
      next_review_at = ?,
      last_reviewed_at = ?,
      review_count = review_count + 1,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ? AND user_id = ?
    `,
    [
      params.reviewStrength,
      params.nextReviewAt,
      params.lastReviewedAt,
      params.cardId,
      params.userId,
    ] as SqlScalar[],
  );
  if (hdr.affectedRows === 0) return null;
  return fetchSavedCardById(params.cardId);
}

async function fetchSavedCardById(
  cardId: number,
): Promise<SavedVocabularyCardCamel | null> {
  const [rows] = await pool.execute<(RowDataPacket & Record<string, unknown>)[]>(
    `
    SELECT
      svc.*,
      pc.video_name AS movie_title
    FROM saved_vocabulary_cards svc
    ${VOCAB_CLIP_JOIN_PART_CATALOG}
    WHERE svc.id = ?
    LIMIT 1
    `,
    [cardId],
  );
  const r = rows[0];
  return r ? mapCamel(r as Record<string, unknown>) : null;
}

export async function deleteSavedVocabularyCardForUser(
  cardId: number,
  userId: UserId,
): Promise<boolean> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `DELETE FROM saved_vocabulary_cards WHERE id = ? AND user_id = ?`,
    [cardId, userId],
  );
  return hdr.affectedRows > 0;
}

/** Achievement / aggregate helpers */

export async function countSavedVocabularyCardsForUser(
  userId: UserId,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `SELECT COUNT(*) AS c FROM saved_vocabulary_cards WHERE user_id = ?`,
    [userId],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

/** Distinct clip ids among `partIds` that the user has saved (any word card). */
export async function listSavedClipIdsForUserParts(
  userId: UserId,
  partIds: string[],
): Promise<Set<string>> {
  if (partIds.length === 0) return new Set();
  const placeholders = partIds.map(() => "?").join(",");
  type R = RowDataPacket & { clip_id: string };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT DISTINCT CAST(clip_id AS CHAR) AS clip_id
    FROM saved_vocabulary_cards
    WHERE user_id = ? AND clip_id IN (${placeholders})
    `,
    [userId, ...partIds] as SqlScalar[],
  );
  return new Set(rows.map((r) => String(r.clip_id)));
}

/** One representative saved card id per clip (newest) among `partIds`. */
export async function listSavedCardIdByClipForUserParts(
  userId: UserId,
  partIds: string[],
): Promise<Map<string, number>> {
  if (partIds.length === 0) return new Map();
  const placeholders = partIds.map(() => "?").join(",");
  type R = RowDataPacket & { clip_id: string; id: number };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT CAST(clip_id AS CHAR) AS clip_id, id
    FROM saved_vocabulary_cards
    WHERE user_id = ? AND clip_id IN (${placeholders})
    ORDER BY created_at DESC, id DESC
    `,
    [userId, ...partIds] as SqlScalar[],
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    const clipId = String(r.clip_id);
    if (!map.has(clipId)) map.set(clipId, Number(r.id));
  }
  return map;
}

/** Recent saved words for a standalone video (movie/documentary). */
export async function listRecentSavedWordsForVideo(
  userId: UserId,
  videoId: string,
  limit = 8,
): Promise<Array<{ word: string; clipId: string }>> {
  const lim = Math.min(Math.max(limit, 1), 40);
  type R = RowDataPacket & { word: string; clip_id: string };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT svc.word AS word, CAST(svc.clip_id AS CHAR) AS clip_id
    FROM saved_vocabulary_cards svc
    INNER JOIN part_catalog pc
      ON pc.part_id COLLATE utf8mb4_unicode_ci = svc.clip_id
    WHERE svc.user_id = ?
      AND pc.video_id = ?
      AND pc.video_type IN ('movie', 'documentary')
    ORDER BY svc.created_at DESC
    LIMIT ${lim}
    `,
    [userId, videoId],
  );
  return rows.map((r) => ({
    word: String(r.word),
    clipId: String(r.clip_id),
  }));
}

/** Recent saved words for one series episode. */
export async function listRecentSavedWordsForEpisode(
  userId: UserId,
  episodeId: string,
  limit = 8,
): Promise<Array<{ word: string; clipId: string }>> {
  const lim = Math.min(Math.max(limit, 1), 40);
  type R = RowDataPacket & { word: string; clip_id: string };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT svc.word AS word, CAST(svc.clip_id AS CHAR) AS clip_id
    FROM saved_vocabulary_cards svc
    INNER JOIN part_catalog pc
      ON pc.part_id COLLATE utf8mb4_unicode_ci = svc.clip_id
    WHERE svc.user_id = ?
      AND pc.episode_id COLLATE utf8mb4_unicode_ci = ?
      AND pc.video_type = 'series'
    ORDER BY svc.created_at DESC
    LIMIT ${lim}
    `,
    [userId, episodeId],
  );
  return rows.map((r) => ({
    word: String(r.word),
    clipId: String(r.clip_id),
  }));
}

export async function deleteSavedVocabularyCardsForUserClip(
  userId: UserId,
  clipId: string,
): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `
    DELETE FROM saved_vocabulary_cards
    WHERE user_id = ? AND clip_id = ?
    `,
    [userId, clipId],
  );
  return Number(result.affectedRows ?? 0);
}

export async function countSavedVocabularyWithReviewStrengthGte(
  userId: UserId,
  minStrength: number,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c FROM saved_vocabulary_cards
    WHERE user_id = ? AND review_strength >= ?
    `,
    [userId, minStrength],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

export async function listSavedVocabularyLastReviewedDates(
  userId: UserId,
): Promise<Date[]> {
  type R = RowDataPacket & { last_reviewed_at: Date };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT last_reviewed_at FROM saved_vocabulary_cards
    WHERE user_id = ? AND last_reviewed_at IS NOT NULL
    `,
    [userId],
  );
  return rows.map((r) => r.last_reviewed_at);
}

export async function countSavedVocabularySentenceWithSpaces(
  userId: UserId,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c FROM saved_vocabulary_cards
    WHERE user_id = ? AND sentence LIKE '% %'
    `,
    [userId],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

/** JSON-serialize-friendly card (camelCase dates as ISO strings). */
export function savedCardToJson(c: SavedVocabularyCardCamel) {
  return {
    id: c.id,
    userId: c.userId,
    word: c.word,
    normalizedWord: c.normalizedWord,
    sentence: c.sentence,
    translation: c.translation,
    movieTitle: c.movieTitle,
    subtitleStartTime: c.subtitleStartTime,
    subtitleEndTime: c.subtitleEndTime,
    previewImage: c.previewImage,
    reviewStrength: c.reviewStrength,
    nextReviewAt: c.nextReviewAt.toISOString(),
    lastReviewedAt: c.lastReviewedAt?.toISOString() ?? null,
    reviewCount: c.reviewCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    clipId: c.clipId,
    episodeId: c.episodeId,
    seasonId: c.seasonId,
  };
}
