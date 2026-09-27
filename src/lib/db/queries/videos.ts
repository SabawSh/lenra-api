/**
 * MySQL query layer for `videos`, `seasons`, `episodes`, `parts`, `caption_translations`.
 */
import { randomUUID } from "crypto";
import { pool } from "@/lib/db/connection";
import { withMysqlConnectionRetry } from "@/lib/db/withMysqlConnectionRetry";
import { asStringArray } from "@/lib/db/jsonStringArray";
import { videoTagFromName } from "@/lib/storage/mediaUploadKey";
import {
  normalizePartSentences,
  normalizePartTokens,
} from "@/lib/learning/normalizePartLearningData";
import {
  buildDifficultyMixFromCounts,
  emptyDifficultyMix,
} from "@/lib/learning/videoDifficultyMix";
import { mapCanonicalKeyFromDb } from "@/lib/db/partsCanonicalKey";
import type {
  CaptionTranslation,
  Episode,
  Part,
  PartDifficulty,
  ProcessingStatus,
  Season,
  Video,
  VideoType,
} from "@/types/video";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

type DbQueryable = Pool | PoolConnection;

type SqlScalar =
  | string
  | number
  | boolean
  | Date
  | bigint
  | Buffer
  | null;

export type VideoScalars = Omit<
  Video,
  "seasons" | "parts" | "partsCount" | "progressPct" | "watched" | "premium"
>;

function q(db: DbQueryable = pool): DbQueryable {
  return db;
}

function tinyBool(v: unknown): boolean {
  return Number(v) === 1;
}

function parseUnknownJson(raw: unknown): unknown {
  if (raw == null) return [];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  return raw;
}

function parseProcessingStatus(raw: unknown): ProcessingStatus {
  if (raw === "processing" || raw === "ready" || raw === "failed") return raw;
  return "pending";
}

function parsePartDifficulty(raw: unknown): PartDifficulty {
  if (raw === "medium" || raw === "hard") return raw;
  return "easy";
}

/** Legacy scripts pass numeric difficulty; map to enum + score. */
export function normalizePartDifficultyInput(
  input: PartDifficulty | number | null | undefined,
): { difficulty: PartDifficulty; difficultyScore: number | null } {
  if (input === "easy" || input === "medium" || input === "hard") {
    return { difficulty: input, difficultyScore: null };
  }
  if (input == null) return { difficulty: "easy", difficultyScore: null };
  const score = Number(input);
  if (!Number.isFinite(score)) {
    return { difficulty: "easy", difficultyScore: null };
  }
  const difficulty: PartDifficulty =
    score >= 3 ? "hard" : score >= 2 ? "medium" : "easy";
  return { difficulty, difficultyScore: score };
}

export function mapRowToVideoScalars(
  row: Record<string, unknown>,
): VideoScalars {
  const genres = parseUnknownJson(row.genres);
  const levelsRaw = parseUnknownJson(
    row.levels ?? (row.level != null ? [String(row.level)] : []),
  );
  const name = String(row.name);
  return {
    id: String(row.id),
    name,
    tag:
      row.tag != null && String(row.tag).trim()
        ? String(row.tag)
        : videoTagFromName(name),
    type: row.type as VideoType,
    description: row.description != null ? String(row.description) : null,
    releaseAt: row.release_at as Date,
    createdAt: row.created_at as Date,
    coverUrl: row.cover_url != null ? String(row.cover_url) : null,
    genres: Array.isArray(genres) ? asStringArray(genres) : [],
    levels: Array.isArray(levelsRaw) ? asStringArray(levelsRaw) : [],
    isNew: tinyBool(row.is_new),
    imdbRating:
      row.imdb_rating !== null && row.imdb_rating !== undefined
        ? Number(row.imdb_rating)
        : null,
    isLiked: tinyBool(row.is_liked),
    durationMs:
      row.duration_ms != null ? Number(row.duration_ms) : null,
    sourceVideoUrl:
      row.source_video_url != null ? String(row.source_video_url) : null,
    sourceSubtitleUrl:
      row.source_subtitle_url != null
        ? String(row.source_subtitle_url)
        : null,
    defaultAudioLanguage: String(row.default_audio_language ?? "en"),
    processingStatus: parseProcessingStatus(row.processing_status),
  };
}

function mapRowToPart(row: Record<string, unknown>): Part {
  const playbackStartMs =
    row.start_ms != null ? Number(row.start_ms) : null;
  const playbackEndMs = row.end_ms != null ? Number(row.end_ms) : null;
  const playbackDurationMs =
    row.duration_ms != null ? Number(row.duration_ms) : null;
  const speechStartMs =
    row.speech_start_ms != null ? Number(row.speech_start_ms) : null;
  const speechEndMs =
    row.speech_end_ms != null ? Number(row.speech_end_ms) : null;
  const speechDurationMs =
    row.speech_duration_ms != null ? Number(row.speech_duration_ms) : null;

  return {
    id: String(row.id),
    episodeId: String(row.episode_id),
    order: Number(row.part_order ?? row.order ?? 0),
    canonicalKey: mapCanonicalKeyFromDb(row.canonical_key),
    speechStartMs,
    speechEndMs,
    speechDurationMs,
    playbackStartMs,
    playbackEndMs,
    playbackDurationMs,
    text: String(row.text),
    normalizedText:
      row.normalized_text != null ? String(row.normalized_text) : null,
    sentences: normalizePartSentences(parseUnknownJson(row.sentences)),
    tokens: normalizePartTokens(parseUnknownJson(row.tokens)),
    subtitles: parseUnknownJson(row.subtitles) as Part["subtitles"],
    wordCount: Number(row.word_count ?? 0),
    speechRate:
      row.speech_rate != null ? Number(row.speech_rate) : null,
    difficulty: parsePartDifficulty(row.difficulty),
    difficultyScore:
      row.difficulty_score != null ? Number(row.difficulty_score) : null,
    clipGroupId:
      row.clip_group_id != null ? String(row.clip_group_id) : null,
    videoUrl: row.video_url != null ? String(row.video_url) : null,
    hlsManifestUrl:
      row.hls_manifest_url != null ? String(row.hls_manifest_url) : null,
    thumbnailUrl:
      row.thumbnail_url != null ? String(row.thumbnail_url) : null,
    sourceClipStartMs:
      row.source_clip_start_ms != null
        ? Number(row.source_clip_start_ms)
        : null,
    sourceClipEndMs:
      row.source_clip_end_ms != null
        ? Number(row.source_clip_end_ms)
        : null,
    processingStatus: parseProcessingStatus(row.processing_status),
    retiredAt: row.retired_at != null ? (row.retired_at as Date) : null,
    createdAt: row.created_at as Date,
  };
}

function mapRowToSeason(row: Record<string, unknown>): Season {
  return {
    id: String(row.id),
    videoId: String(row.video_id),
    seasonNum: Number(row.season_num),
    coverUrl: row.cover_url != null ? String(row.cover_url) : null,
  };
}

function mapRowToEpisode(row: Record<string, unknown>): Episode {
  return {
    id: String(row.id),
    seasonId: String(row.season_id),
    episodeNum: Number(row.episode_num),
    title: String(row.title),
    description:
      row.description != null ? String(row.description) : null,
    coverUrl: row.cover_url != null ? String(row.cover_url) : null,
    releaseAt: row.release_at as Date,
    durationMs:
      row.duration_ms != null ? Number(row.duration_ms) : null,
    sourceVideoUrl:
      row.source_video_url != null ? String(row.source_video_url) : null,
    sourceSubtitleUrl:
      row.source_subtitle_url != null
        ? String(row.source_subtitle_url)
        : null,
    processingStatus: parseProcessingStatus(row.processing_status),
    createdAt: row.created_at as Date,
  };
}

function mapRowToCaption(row: Record<string, unknown>): CaptionTranslation {
  return {
    id: Number(row.id),
    partId: String(row.part_id),
    language: String(row.language),
    text: String(row.text),
    translatedSentences: parseUnknownJson(
      row.translated_sentences,
    ) as CaptionTranslation["translatedSentences"],
    provider: row.provider != null ? String(row.provider) : null,
    providerModel:
      row.provider_model != null ? String(row.provider_model) : null,
    createdAt: row.created_at as Date,
  };
}

async function execRows<T extends RowDataPacket>(
  sql: string,
  params: SqlScalar[],
  db?: DbQueryable,
): Promise<T[]> {
  return withMysqlConnectionRetry(async () => {
    const [rows] = await q(db).execute<T[]>(sql, params);
    return rows;
  });
}

/** mysql2 prepared statements reject bound LIMIT placeholders on some MySQL servers. */
function sqlLimit(take: number): number {
  const n = Math.trunc(Number(take));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 10_000);
}

async function execOne<T extends RowDataPacket>(
  sql: string,
  params: SqlScalar[],
  db?: DbQueryable,
): Promise<T | null> {
  const rows = await execRows<T>(sql, params, db);
  return rows[0] ?? null;
}

/** --- Videos --- */

export async function fetchAllVideoTags(): Promise<
  Array<{ id: string; name: string; tag: string; type: VideoType }>
> {
  const rows = await execRows<
    RowDataPacket & {
      id: string;
      name: string;
      tag: string | null;
      type: VideoType;
    }
  >(
    `
    SELECT CAST(id AS CHAR) AS id, name, tag, type
    FROM videos
    `,
    [],
  );
  return rows.map((r) => {
    const name = String(r.name);
    const tag =
      r.tag != null && String(r.tag).trim()
        ? String(r.tag)
        : videoTagFromName(name);
    return {
      id: String(r.id),
      name,
      tag,
      type: r.type as VideoType,
    };
  });
}

/** @deprecated Use fetchAllVideoTags */
export const fetchAllVideoTitles = fetchAllVideoTags;

export async function listVideosLatestFirst(
  limit?: number,
  db?: DbQueryable,
): Promise<VideoScalars[]> {
  const base = `
    SELECT *
    FROM videos
    ORDER BY created_at DESC
  `;
  const rows =
    typeof limit === "number" && limit > 0
      ? await execRows<RowDataPacket>(
          `${base} LIMIT ${sqlLimit(limit)}`,
          [],
          db,
        )
      : await execRows<RowDataPacket>(base, [], db);
  return rows.map((r) => mapRowToVideoScalars(r as Record<string, unknown>));
}

export async function fetchVideoScalarsById(
  id: string,
  db?: DbQueryable,
): Promise<VideoScalars | null> {
  const row = await execOne<RowDataPacket>(
    `SELECT * FROM videos WHERE id = ? LIMIT 1`,
    [id],
    db,
  );
  return row ? mapRowToVideoScalars(row as Record<string, unknown>) : null;
}

export async function fetchVideoIsLikedByIdOnly(
  id: string,
): Promise<boolean | null> {
  type R = RowDataPacket & { is_liked: number };
  const row = await execOne<R>(
    `SELECT is_liked FROM videos WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!row) return null;
  return tinyBool(row.is_liked);
}

export async function updateVideoIsLiked(
  id: string,
  isLiked: boolean,
): Promise<boolean> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `UPDATE videos SET is_liked = ? WHERE id = ?`,
    [isLiked ? 1 : 0, id],
  );
  return hdr.affectedRows > 0;
}

export async function insertVideoScalars(params: {
  id?: string;
  name: string;
  tag?: string;
  type: VideoType;
  description?: string | null;
  releaseAt: Date;
  coverUrl?: string | null;
  genres?: string[];
  levels?: string[];
  isNew?: boolean;
}): Promise<VideoScalars> {
  const id = params.id ?? randomUUID();
  const tag = (params.tag?.trim() || videoTagFromName(params.name)).slice(0, 64);
  const genresJson = JSON.stringify(params.genres ?? []);
  const levelsJson = JSON.stringify(params.levels ?? []);
  const isNew = params.isNew !== undefined ? (params.isNew ? 1 : 0) : 1;
  await pool.execute<ResultSetHeader>(
    `
    INSERT INTO videos (
      id, name, tag, type, release_at, description, cover_url, genres, levels, is_new, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, NOW(3))
    `,
    [
      id,
      params.name,
      tag,
      params.type,
      params.releaseAt,
      params.description ?? null,
      params.coverUrl ?? null,
      genresJson,
      levelsJson,
      isNew,
    ],
  );
  const v = await fetchVideoScalarsById(id);
  if (!v) throw new Error("insertVideoScalars: missing row after insert");
  if (isStandaloneVideoType(v.type)) {
    await ensureCanonicalShellForVideo(v.id);
  }
  return v;
}

export async function deleteVideoByPk(id: string): Promise<boolean> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `DELETE FROM videos WHERE id = ?`,
    [id],
  );
  return hdr.affectedRows > 0;
}

export type VideoMetaPatch = {
  levels?: string[];
  genres?: string[];
  isNew?: boolean;
  imdbRating?: number | null;
  isLiked?: boolean;
  releaseAt?: Date;
};

export async function patchVideoScalars(
  id: string,
  patch: VideoMetaPatch,
): Promise<boolean> {
  const sets: string[] = [];
  const vals: SqlScalar[] = [];
  if (patch.levels !== undefined) {
    sets.push("levels = CAST(? AS JSON)");
    vals.push(JSON.stringify(patch.levels));
  }
  if (patch.genres !== undefined) {
    sets.push("genres = ?");
    vals.push(JSON.stringify(patch.genres));
  }
  if (patch.isNew !== undefined) {
    sets.push("is_new = ?");
    vals.push(patch.isNew ? 1 : 0);
  }
  if (patch.imdbRating !== undefined) {
    sets.push("imdb_rating = ?");
    vals.push(patch.imdbRating);
  }
  if (patch.isLiked !== undefined) {
    sets.push("is_liked = ?");
    vals.push(patch.isLiked ? 1 : 0);
  }
  if (patch.releaseAt !== undefined) {
    sets.push("release_at = ?");
    vals.push(patch.releaseAt);
  }
  if (sets.length === 0) return false;
  vals.push(id);
  const [hdr] = await pool.execute<ResultSetHeader>(
    `UPDATE videos SET ${sets.join(", ")} WHERE id = ?`,
    vals,
  );
  return hdr.affectedRows > 0;
}

export async function updateVideoCoverUrl(
  id: string,
  coverUrl: string | null,
): Promise<boolean> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `UPDATE videos SET cover_url = ? WHERE id = ?`,
    [coverUrl, id],
  );
  return hdr.affectedRows > 0;
}

export async function searchVideosByNamePrefix(
  qStr: string,
  limit: number,
): Promise<VideoScalars[]> {
  const term = `%${qStr.trim()}%`;
  const lim = sqlLimit(Math.min(limit, 100));
  const rows = await execRows<RowDataPacket>(
    `SELECT * FROM videos WHERE name LIKE ? ORDER BY name ASC LIMIT ${lim}`,
    [term],
  );
  return rows.map((r) => mapRowToVideoScalars(r as Record<string, unknown>));
}

export async function listVideosByTypes(
  types: VideoType[],
  db?: DbQueryable,
): Promise<VideoScalars[]> {
  if (types.length === 0) return [];
  const ph = types.map(() => "?").join(", ");
  const rows = await execRows<RowDataPacket>(
    `
    SELECT * FROM videos WHERE type IN (${ph})
    ORDER BY created_at DESC
    `,
    types as SqlScalar[],
    db,
  );
  return rows.map((r) => mapRowToVideoScalars(r as Record<string, unknown>));
}

export async function fetchMovieStandalonePartCount(
  videoId: string,
): Promise<number> {
  return countPartsForVideoId(videoId);
}

export async function listLikedVideosWithCounts(): Promise<
  Array<{
    video: VideoScalars;
    partsCount: number;
    seasons: Array<Season & { _count: { episodes: number } }>;
  }>
> {
  const videos = await execRows<RowDataPacket>(
    `SELECT * FROM videos WHERE is_liked = 1 ORDER BY created_at DESC`,
    [],
  );
  const out: Array<{
    video: VideoScalars;
    partsCount: number;
    seasons: Array<Season & { _count: { episodes: number } }>;
  }> = [];

  for (const vr of videos) {
    const v = mapRowToVideoScalars(vr as Record<string, unknown>);
    const pidCount = await fetchMovieStandalonePartCount(v.id);
    const seasonsRaw = await execRows<RowDataPacket>(
      `
      SELECT s.*,
        (SELECT COUNT(*) FROM episodes e WHERE e.season_id = s.id) AS ep_count
      FROM seasons s
      WHERE s.video_id = ?
      ORDER BY s.season_num ASC
      `,
      [v.id],
    );
    const seasons = seasonsRaw.map((sr) => {
      const season = mapRowToSeason(sr as Record<string, unknown>);
      const epCount = Number((sr as Record<string, unknown>).ep_count);
      return {
        ...season,
        _count: { episodes: epCount },
      };
    });

    out.push({ video: v, partsCount: pidCount, seasons });
  }
  return out;
}

/** Episodes globally with attached part IDs (achievement metrics). */
export async function listAllEpisodePartIdGroups(): Promise<
  Array<{ id: string; partIds: string[] }>
> {
  type R = RowDataPacket & { episode_id: string; part_id: string | Buffer };
  const rows = await execRows<R>(
    `
    SELECT CAST(pc.episode_id AS CHAR) AS episode_id, CAST(pc.part_id AS CHAR) AS part_id
    FROM part_catalog pc
    `,
    [],
  );
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    const ep = String(r.episode_id);
    if (!m.has(ep)) m.set(ep, new Set());
    if (r.part_id) m.get(ep)!.add(String(r.part_id));
  }
  return [...m.entries()].map(([id, set]) => ({ id, partIds: [...set] }));
}

/** Movie/documentary rows with all part IDs (via canonical hierarchy). */
export async function listStandaloneVideoPartGroups(
  candidateVideoIds: string[],
): Promise<Array<{ id: string; partIds: string[] }>> {
  if (candidateVideoIds.length === 0) return [];
  const ph = candidateVideoIds.map(() => "?").join(", ");
  type R = RowDataPacket & { vid: string; part_id: string | Buffer };
  const rows = await execRows<R>(
    `
    SELECT CAST(pc.video_id AS CHAR) AS vid, CAST(pc.part_id AS CHAR) AS part_id
    FROM part_catalog pc
    WHERE pc.video_type IN ('movie', 'documentary')
      AND pc.video_id IN (${ph})
    `,
    candidateVideoIds as SqlScalar[],
  );
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    const vid = String(r.vid);
    if (!m.has(vid)) m.set(vid, new Set());
    if (r.part_id) m.get(vid)!.add(String(r.part_id));
  }
  return [...m.entries()].map(([id, set]) => ({ id, partIds: [...set] }));
}

/** @deprecated Use {@link listStandaloneVideoPartGroups}. */
export const listMoviesWithStandalonePartGroups = listStandaloneVideoPartGroups;

/** --- Seasons --- */

export async function findSeasonIdByVideoAndSeasonNum(
  videoId: string,
  seasonNum: number,
): Promise<string | null> {
  type R = RowDataPacket & { id: string };
  const row = await execOne<R>(
    `
    SELECT CAST(id AS CHAR) AS id
    FROM seasons
    WHERE video_id = ? AND season_num = ?
    LIMIT 1
    `,
    [videoId, seasonNum],
  );
  return row ? String(row.id) : null;
}

export async function listSeasonsAscByVideoId(
  videoId: string,
  db?: DbQueryable,
): Promise<Season[]> {
  const rows = await execRows<RowDataPacket>(
    `
    SELECT *
    FROM seasons
    WHERE video_id = ?
    ORDER BY season_num ASC
    `,
    [videoId],
    db,
  );
  return rows.map((r) => mapRowToSeason(r as Record<string, unknown>));
}

export async function insertSeasonRecord(params: {
  id?: string;
  videoId: string;
  seasonNum: number;
  coverUrl?: string | null;
}): Promise<Season> {
  const id = params.id ?? randomUUID();
  await pool.execute<ResultSetHeader>(
    `
    INSERT INTO seasons (id, video_id, season_num, cover_url)
    VALUES (?, ?, ?, ?)
    `,
    [id, params.videoId, params.seasonNum, params.coverUrl ?? null],
  );
  const row = await execOne<RowDataPacket>(
    `SELECT * FROM seasons WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!row) throw new Error("insertSeasonRecord: row missing");
  return mapRowToSeason(row as Record<string, unknown>);
}

export async function updateSeasonCoverUrl(
  seasonId: string,
  coverUrl: string | null,
): Promise<boolean> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `UPDATE seasons SET cover_url = ? WHERE id = ?`,
    [coverUrl, seasonId],
  );
  return hdr.affectedRows > 0;
}

export async function findSeasonFirstByVideoNumCover(
  videoId: string,
  seasonNum: number,
  coverUrl: string | null,
): Promise<Season | null> {
  const row = await execOne<RowDataPacket>(
    `
    SELECT * FROM seasons
    WHERE video_id = ? AND season_num = ?
      AND (cover_url <=> ?)
    LIMIT 1
    `,
    [videoId, seasonNum, coverUrl],
  );
  return row ? mapRowToSeason(row as Record<string, unknown>) : null;
}

export async function fetchSeasonById(
  seasonId: string,
): Promise<Season | null> {
  const row = await execOne<RowDataPacket>(
    `SELECT * FROM seasons WHERE id = ? LIMIT 1`,
    [seasonId],
  );
  return row ? mapRowToSeason(row as Record<string, unknown>) : null;
}

/** --- Episodes --- */

export async function findEpisodeIdBySeasonAndEpisodeNum(
  seasonId: string,
  episodeNum: number,
): Promise<string | null> {
  type R = RowDataPacket & { id: string };
  const row = await execOne<R>(
    `
    SELECT CAST(id AS CHAR) AS id
    FROM episodes
    WHERE season_id = ? AND episode_num = ?
    LIMIT 1
    `,
    [seasonId, episodeNum],
  );
  return row ? String(row.id) : null;
}

export async function insertEpisodeRecord(params: {
  id?: string;
  seasonId: string;
  episodeNum: number;
  title: string;
  description?: string | null;
  releaseAt: Date;
  coverUrl?: string | null;
}): Promise<Episode> {
  const id = params.id ?? randomUUID();
  await pool.execute<ResultSetHeader>(
    `
    INSERT INTO episodes (
      id, season_id, episode_num, title, description, release_at, cover_url
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      params.seasonId,
      params.episodeNum,
      params.title,
      params.description ?? null,
      params.releaseAt,
      params.coverUrl ?? null,
    ],
  );
  const row = await execOne<RowDataPacket>(
    `SELECT * FROM episodes WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!row) throw new Error("insertEpisodeRecord: row missing");
  return mapRowToEpisode(row as Record<string, unknown>);
}

export async function updateEpisodeCoverUrl(
  episodeId: string,
  coverUrl: string | null,
): Promise<boolean> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `UPDATE episodes SET cover_url = ? WHERE id = ?`,
    [coverUrl, episodeId],
  );
  return hdr.affectedRows > 0;
}

export async function fetchEpisodeById(
  episodeId: string,
): Promise<Episode | null> {
  const row = await execOne<RowDataPacket>(
    `SELECT * FROM episodes WHERE id = ? LIMIT 1`,
    [episodeId],
  );
  return row ? mapRowToEpisode(row as Record<string, unknown>) : null;
}

export async function findEpisodeFirstBySeasonAndNum(
  seasonId: string,
  episodeNum: number,
): Promise<Episode | null> {
  const row = await execOne<RowDataPacket>(
    `
    SELECT * FROM episodes
    WHERE season_id = ? AND episode_num = ?
    LIMIT 1
    `,
    [seasonId, episodeNum],
  );
  return row ? mapRowToEpisode(row as Record<string, unknown>) : null;
}

export async function findFirstEpisodeIdHavingParts(): Promise<string | null> {
  type R = RowDataPacket & { id: string };
  const row = await execOne<R>(
    `
    SELECT CAST(e.id AS CHAR) AS id
    FROM episodes e
    WHERE EXISTS (
      SELECT 1 FROM parts p WHERE p.episode_id = e.id
    )
    ORDER BY e.id ASC
    LIMIT 1
    `,
    [],
  );
  return row ? String(row.id) : null;
}

export async function findEpisodeIdBySeriesTitleSeasonEpisode(
  videoName: string,
  videoType: VideoType,
  seasonNum: number,
  episodeNum: number,
): Promise<string | null> {
  const v = await findVideoByNameAndType(videoName, videoType);
  if (!v) return null;
  const seasons = await listSeasonsAscByVideoId(v.id);
  const s = seasons.find((x) => x.seasonNum === seasonNum);
  if (!s) return null;
  const ep = await findEpisodeFirstBySeasonAndNum(s.id, episodeNum);
  return ep ? ep.id : null;
}

export async function listEpisodesAscBySeasonId(
  seasonId: string,
  db?: DbQueryable,
): Promise<Episode[]> {
  const rows = await execRows<RowDataPacket>(
    `
    SELECT * FROM episodes
    WHERE season_id = ?
    ORDER BY episode_num ASC
    `,
    [seasonId],
    db,
  );
  return rows.map((r) => mapRowToEpisode(r as Record<string, unknown>));
}

export async function fetchEpisodeSummaryWithPartUrls(
  episodeId: string,
): Promise<{ title: string; episodeNum: number; parts: { url: string }[] } | null> {
  const ep = await fetchEpisodeById(episodeId);
  if (!ep) return null;
  type R = RowDataPacket & { url: string };
  const parts = await execRows<R>(
    `SELECT video_url AS url FROM parts WHERE episode_id = ? ORDER BY \`order\` ASC`,
    [episodeId],
  );
  return {
    title: ep.title,
    episodeNum: ep.episodeNum,
    parts: parts.map((p) => ({ url: String(p.videoUrl ?? "") })),
  };
}

export async function listEpisodesWithPartsBySeasonId(
  seasonId: string,
): Promise<Array<Episode & { parts: Part[] }>> {
  const eps = await listEpisodesAscBySeasonId(seasonId);
  const out: Array<Episode & { parts: Part[] }> = [];
  for (const e of eps) {
    const parts = await listPartsByEpisodeOrdered(e.id);
    out.push({ ...e, parts });
  }
  return out;
}

/** --- Parts --- */

export async function countPartsForEpisodeId(
  episodeId: string,
  db?: DbQueryable,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const row = await execOne<R>(
    `SELECT COUNT(*) AS c FROM parts WHERE episode_id = ? AND retired_at IS NULL`,
    [episodeId],
    db,
  );
  return row ? Number(row.c) : 0;
}

export async function countPartsForVideoId(
  videoId: string,
  db?: DbQueryable,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const row = await execOne<R>(
    `
    SELECT COUNT(*) AS c
    FROM parts p
    INNER JOIN episodes e ON e.id = p.episode_id
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE s.video_id = ?
      AND p.retired_at IS NULL
    `,
    [videoId],
    db,
  );
  return row ? Number(row.c) : 0;
}

/** Part counts for many standalone titles in one query (avoids N+1 on library loads). */
export async function countPartsForVideoIds(
  videoIds: string[],
  db?: DbQueryable,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (videoIds.length === 0) return counts;

  for (const id of videoIds) counts.set(id, 0);

  const ph = videoIds.map(() => "?").join(", ");
  type R = RowDataPacket & { video_id: string; c: bigint };
  const rows = await execRows<R>(
    `
    SELECT CAST(s.video_id AS CHAR) AS video_id, COUNT(*) AS c
    FROM parts p
    INNER JOIN episodes e ON e.id = p.episode_id
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE s.video_id IN (${ph})
      AND p.retired_at IS NULL
    GROUP BY s.video_id
    `,
    videoIds as SqlScalar[],
    db,
  );

  for (const row of rows) {
    counts.set(String(row.video_id), Number(row.c));
  }
  return counts;
}

/**
 * Batched content-difficulty counts per video from `parts.difficulty`.
 * One query for the whole library — never N+1.
 * Maps hard → advanced in application code (see videoDifficultyMix).
 */
export async function countPartDifficultyForVideoIds(
  videoIds: string[],
  db?: DbQueryable,
): Promise<
  Map<
    string,
    {
      easy: number;
      medium: number;
      advanced: number;
      total: number;
    }
  >
> {
  const mixes = new Map<
    string,
    {
      easy: number;
      medium: number;
      advanced: number;
      total: number;
    }
  >();
  if (videoIds.length === 0) return mixes;

  for (const id of videoIds) mixes.set(id, emptyDifficultyMix());

  const ph = videoIds.map(() => "?").join(", ");
  type R = RowDataPacket & {
    video_id: string;
    difficulty: string;
    c: bigint;
  };
  const rows = await execRows<R>(
    `
    SELECT
      CAST(s.video_id AS CHAR) AS video_id,
      p.difficulty AS difficulty,
      COUNT(*) AS c
    FROM parts p
    INNER JOIN episodes e ON e.id = p.episode_id
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE s.video_id IN (${ph})
      AND p.retired_at IS NULL
    GROUP BY s.video_id, p.difficulty
    `,
    videoIds as SqlScalar[],
    db,
  );

  const raw = new Map<
    string,
    { easy: number; medium: number; hard: number }
  >();
  for (const id of videoIds) {
    raw.set(id, { easy: 0, medium: 0, hard: 0 });
  }

  for (const row of rows) {
    const videoId = String(row.video_id);
    const bucket = String(row.difficulty ?? "")
      .trim()
      .toLowerCase();
    const n = Number(row.c);
    const entry = raw.get(videoId) ?? { easy: 0, medium: 0, hard: 0 };
    if (bucket === "easy") entry.easy += n;
    else if (bucket === "medium") entry.medium += n;
    else if (bucket === "hard") entry.hard += n;
    raw.set(videoId, entry);
  }

  for (const [videoId, counts] of raw) {
    mixes.set(videoId, buildDifficultyMixFromCounts(counts));
  }

  return mixes;
}

export async function countPartDifficultyForEpisodeId(
  episodeId: string,
  db?: DbQueryable,
): Promise<{
  easy: number;
  medium: number;
  advanced: number;
  total: number;
}> {
  type R = RowDataPacket & { difficulty: string; c: bigint };
  const rows = await execRows<R>(
    `
    SELECT p.difficulty AS difficulty, COUNT(*) AS c
    FROM parts p
    WHERE p.episode_id = ?
      AND p.retired_at IS NULL
    GROUP BY p.difficulty
    `,
    [episodeId],
    db,
  );

  const counts = { easy: 0, medium: 0, hard: 0 };
  for (const row of rows) {
    const bucket = String(row.difficulty ?? "")
      .trim()
      .toLowerCase();
    const n = Number(row.c);
    if (bucket === "easy") counts.easy += n;
    else if (bucket === "medium") counts.medium += n;
    else if (bucket === "hard") counts.hard += n;
  }
  return buildDifficultyMixFromCounts(counts);
}

function partScopeWhere(
  episodeId?: string,
  videoId?: string,
): { clause: string; params: SqlScalar[] } {
  if (episodeId) {
    return {
      clause: "episode_id = ? AND retired_at IS NULL",
      params: [episodeId],
    };
  }
  if (videoId) {
    return {
      clause: `episode_id IN (
        SELECT e.id FROM episodes e
        INNER JOIN seasons s ON s.id = e.season_id
        WHERE s.video_id = ?
      ) AND retired_at IS NULL`,
      params: [videoId],
    };
  }
  throw new Error("partScopeWhere: need episodeId or videoId");
}

/** Standalone catalog titles use a single S1E1 shell in the normalized hierarchy. */
export const CANONICAL_SEASON_NUM = 1;
export const CANONICAL_EPISODE_NUM = 1;

export function isStandaloneVideoType(type: VideoType): boolean {
  return type === "movie" || type === "documentary";
}

function defaultStandaloneEpisodeTitle(videoName: string): string {
  return videoName.slice(0, 191);
}

/**
 * Ensures season 1 and episode 1 exist for a movie or documentary.
 * Idempotent — safe to call from seeds, imports, and part upserts.
 */
export async function ensureCanonicalShellForVideo(
  videoId: string,
  db?: DbQueryable,
): Promise<{ seasonId: string; episodeId: string }> {
  const video = await fetchVideoScalarsById(videoId, db);
  if (!video) {
    throw new Error(`ensureCanonicalShellForVideo: video not found ${videoId}`);
  }
  if (!isStandaloneVideoType(video.type)) {
    throw new Error(
      `ensureCanonicalShellForVideo: unsupported type ${video.type} for ${videoId}`,
    );
  }

  let seasonId = await findSeasonIdByVideoAndSeasonNum(
    videoId,
    CANONICAL_SEASON_NUM,
  );
  if (!seasonId) {
    const season = await insertSeasonRecord({
      videoId,
      seasonNum: CANONICAL_SEASON_NUM,
      coverUrl: null,
    });
    seasonId = season.id;
  }

  let episodeId = await findEpisodeIdBySeasonAndEpisodeNum(
    seasonId,
    CANONICAL_EPISODE_NUM,
  );
  if (!episodeId) {
    const episode = await insertEpisodeRecord({
      seasonId,
      episodeNum: CANONICAL_EPISODE_NUM,
      title: defaultStandaloneEpisodeTitle(video.name),
      description: null,
      releaseAt: video.releaseAt,
      coverUrl: null,
    });
    episodeId = episode.id;
  }

  return { seasonId, episodeId };
}

/** Primary episode for a video (S1E1 for standalone; lowest season/episode for series). */
export async function findPrimaryEpisodeIdForVideo(
  videoId: string,
): Promise<string | null> {
  type R = RowDataPacket & { id: string };
  const row = await execOne<R>(
    `
    SELECT CAST(e.id AS CHAR) AS id
    FROM episodes e
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE s.video_id = ?
    ORDER BY s.season_num ASC, e.episode_num ASC
    LIMIT 1
    `,
    [videoId],
  );
  return row ? String(row.id) : null;
}

export async function listPartIdOrderOnly(params: {
  episodeId?: string;
  videoId?: string;
}): Promise<Array<{ id: string; order: number }>> {
  const { clause, params: p } = partScopeWhere(
    params.episodeId,
    params.videoId,
  );
  type R = RowDataPacket & { pid: string; ord: number };
  const rows = await execRows<R>(
    `
    SELECT CAST(id AS CHAR) AS pid, \`order\` AS ord
    FROM parts
    WHERE ${clause}
    ORDER BY \`order\` ASC
    `,
    p,
  );
  return rows.map((r) => ({ id: String(r.pid), order: Number(r.ord) }));
}

export async function listPartIdOrderDuration(params: {
  episodeId?: string;
  videoId?: string;
}): Promise<Array<{ id: string; order: number; playbackDurationMs: number }>> {
  const { clause, params: p } = partScopeWhere(
    params.episodeId,
    params.videoId,
  );
  type R = RowDataPacket & { pid: string; ord: number; duration_ms: number };
  const rows = await execRows<R>(
    `
    SELECT CAST(id AS CHAR) AS pid, \`order\` AS ord, duration_ms
    FROM parts
    WHERE ${clause}
    ORDER BY \`order\` ASC
    `,
    p,
  );
  return rows.map((r) => ({
    id: String(r.pid),
    order: Number(r.ord),
    playbackDurationMs: Number(r.duration_ms),
  }));
}

export async function listPartIdsInOrderRange(params: {
  episodeId?: string;
  videoId?: string;
  orderGte: number;
  orderLte: number;
}): Promise<Array<{ id: string; order: number }>> {
  const { clause, params: p } = partScopeWhere(
    params.episodeId,
    params.videoId,
  );
  type R = RowDataPacket & { pid: string; ord: number };
  const rows = await execRows<R>(
    `
    SELECT CAST(id AS CHAR) AS pid, \`order\` AS ord
    FROM parts
    WHERE ${clause}
      AND \`order\` >= ? AND \`order\` <= ?
    ORDER BY \`order\` ASC
    `,
    [...p, params.orderGte, params.orderLte],
  );
  return rows.map((r) => ({ id: String(r.pid), order: Number(r.ord) }));
}

export async function findFirstPartIdAtExactOrder(params: {
  episodeId?: string;
  videoId?: string;
  order: number;
}): Promise<string | null> {
  const { clause, params: p } = partScopeWhere(
    params.episodeId,
    params.videoId,
  );
  type R = RowDataPacket & { pid: string };
  const row = await execOne<R>(
    `
    SELECT CAST(id AS CHAR) AS pid
    FROM parts
    WHERE ${clause} AND \`order\` = ?
    LIMIT 1
    `,
    [...p, params.order],
  );
  return row ? String(row.pid) : null;
}

export async function fetchPartTranslations(
  partId: string,
): Promise<CaptionTranslation[]> {
  const map = await listCaptionTranslationsByPartIds([partId]);
  return map.get(partId) ?? [];
}

/** One query for many parts — avoids N+1 on section hydrate / batch preview. */
export async function listCaptionTranslationsByPartIds(
  partIds: readonly string[],
): Promise<Map<string, CaptionTranslation[]>> {
  const out = new Map<string, CaptionTranslation[]>();
  if (partIds.length === 0) return out;
  for (const id of partIds) out.set(id, []);

  const placeholders = partIds.map(() => "?").join(",");
  const rows = await execRows<RowDataPacket>(
    `
    SELECT *
    FROM caption_translations
    WHERE part_id IN (${placeholders})
    ORDER BY part_id ASC, id ASC
    `,
    [...partIds] as SqlScalar[],
  );
  for (const row of rows) {
    const mapped = mapRowToCaption(row as Record<string, unknown>);
    const list = out.get(mapped.partId) ?? [];
    list.push(mapped);
    out.set(mapped.partId, list);
  }
  return out;
}

export async function findPartByOwnershipAndOrder(params: {
  order: number;
  videoId?: string;
  episodeId?: string;
}): Promise<Part | null> {
  let clause = "";
  const vals: SqlScalar[] = [];
  const scope = partScopeWhere(params.episodeId, params.videoId);
  clause = `${scope.clause} AND `;
  vals.push(...scope.params);
  vals.push(params.order);
  const row = await execOne<RowDataPacket>(
    `
    SELECT *,
      \`order\` AS part_order
    FROM parts
    WHERE ${clause}\`order\` = ?
    LIMIT 1
    `,
    vals,
  );
  return row ? mapRowToPart(row as Record<string, unknown>) : null;
}

export async function findPartByOrderWithTranslations(params: {
  order: number;
  videoId?: string;
  episodeId?: string;
}): Promise<(Part & { translations: CaptionTranslation[] }) | null> {
  const base = await findPartByOwnershipAndOrder(params);
  if (!base) return null;
  const tr = await fetchPartTranslations(base.id);
  return { ...base, translations: tr };
}

export async function findPartClipUrlByOrderScoped(params: {
  order: number;
  videoId?: string;
  episodeId?: string;
}): Promise<string | null> {
  const p = await findPartByOwnershipAndOrder(params);
  return p?.videoUrl ?? null;
}

export async function listPartUrlsForOrders(params: {
  orders: number[];
  videoId?: string;
  episodeId?: string;
}): Promise<Array<{ order: number; url: string }>> {
  if (params.orders.length === 0) return [];
  const unique = [...new Set(params.orders.filter((n) => Number.isFinite(n)))];
  const ph = unique.map(() => "?").join(", ");
  const { clause, params: scopeParams } = partScopeWhere(
    params.episodeId,
    params.videoId,
  );
  const vals: SqlScalar[] = [...scopeParams, ...unique];
  type R = RowDataPacket & { ord: number; url: string };
  const rows = await execRows<R>(
    `
    SELECT \`order\` AS ord, video_url AS url FROM parts
    WHERE ${clause} AND \`order\` IN (${ph})
    `,
    vals,
  );
  return rows.map((r) => ({ order: Number(r.ord), url: String(r.url) }));
}

export async function listPartPreloadMetaForOrdersScoped(params: {
  orders: number[];
  videoId?: string;
  episodeId?: string;
}): Promise<
  Array<{ order: number; url: string; hlsManifestUrl: string | null }>
> {
  if (params.orders.length === 0) return [];
  const unique = [...new Set(params.orders.filter((n) => Number.isFinite(n)))];
  const ph = unique.map(() => "?").join(", ");
  const { clause, params: scopeParams } = partScopeWhere(
    params.episodeId,
    params.videoId,
  );
  const vals: SqlScalar[] = [...scopeParams, ...unique];
  type R = RowDataPacket & {
    ord: number;
    url: string;
    hls_manifest_url: string | null;
  };
  const rows = await execRows<R>(
    `
    SELECT \`order\` AS ord, video_url AS url, hls_manifest_url FROM parts
    WHERE ${clause} AND \`order\` IN (${ph})
    `,
    vals,
  );
  return rows.map((r) => ({
    order: Number(r.ord),
    url: String(r.url),
    hlsManifestUrl: r.hls_manifest_url,
  }));
}

export type PartOrderMeta = {
  id: string;
  order: number;
  difficulty: PartDifficulty;
  difficultyScore: number | null;
};

function mapRowToPartOrderMeta(row: Record<string, unknown>): PartOrderMeta {
  return {
    id: String(row.id),
    order: Number(row.part_order ?? row.order ?? 0),
    difficulty: parsePartDifficulty(row.difficulty),
    difficultyScore:
      row.difficulty_score != null ? Number(row.difficulty_score) : null,
  };
}

export async function listPartOrderMetaByEpisodeId(
  episodeId: string,
  db?: DbQueryable,
): Promise<PartOrderMeta[]> {
  const rows = await execRows<RowDataPacket>(
    `
    SELECT id, \`order\` AS part_order, difficulty, difficulty_score
    FROM parts
    WHERE episode_id = ?
      AND retired_at IS NULL
    ORDER BY \`order\` ASC
    `,
    [episodeId],
    db,
  );
  return rows.map((r) => mapRowToPartOrderMeta(r as Record<string, unknown>));
}

export async function listPartOrderMetaByVideoId(
  videoId: string,
  db?: DbQueryable,
): Promise<PartOrderMeta[]> {
  const rows = await execRows<RowDataPacket>(
    `
    SELECT p.id, p.\`order\` AS part_order, p.difficulty, p.difficulty_score
    FROM parts p
    INNER JOIN episodes e ON e.id = p.episode_id
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE s.video_id = ?
      AND p.retired_at IS NULL
    ORDER BY s.season_num ASC, e.episode_num ASC, p.\`order\` ASC
    `,
    [videoId],
    db,
  );
  return rows.map((r) => mapRowToPartOrderMeta(r as Record<string, unknown>));
}

/**
 * Lightweight stamp for part-order Data Cache keys.
 * Changes whenever parts are rebuilt (new UUIDs / orders), so stale ID lists
 * cannot survive a destructive content refresh even if tag revalidation races.
 */
export async function getPartOrderCacheStampForVideo(
  videoId: string,
  db?: DbQueryable,
): Promise<string> {
  const rows = await execRows<RowDataPacket>(
    `
    SELECT
      COUNT(*) AS part_count,
      COALESCE(MAX(p.created_at), '0') AS max_created,
      COALESCE(MIN(CAST(p.id AS CHAR)), '') AS min_id,
      COALESCE(MAX(CAST(p.id AS CHAR)), '') AS max_id
    FROM parts p
    INNER JOIN episodes e ON e.id = p.episode_id
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE s.video_id = ?
      AND p.retired_at IS NULL
    `,
    [videoId],
    db,
  );
  const row = rows[0];
  return [
    String(row?.part_count ?? 0),
    String(row?.max_created ?? "0"),
    String(row?.min_id ?? ""),
    String(row?.max_id ?? ""),
  ].join("|");
}

export async function getPartOrderCacheStampForEpisode(
  episodeId: string,
  db?: DbQueryable,
): Promise<string> {
  const rows = await execRows<RowDataPacket>(
    `
    SELECT
      COUNT(*) AS part_count,
      COALESCE(MAX(created_at), '0') AS max_created,
      COALESCE(MIN(CAST(id AS CHAR)), '') AS min_id,
      COALESCE(MAX(CAST(id AS CHAR)), '') AS max_id
    FROM parts
    WHERE episode_id = ?
      AND retired_at IS NULL
    `,
    [episodeId],
    db,
  );
  const row = rows[0];
  return [
    String(row?.part_count ?? 0),
    String(row?.max_created ?? "0"),
    String(row?.min_id ?? ""),
    String(row?.max_id ?? ""),
  ].join("|");
}

/** Lean fields for learning-unit merge — no translations or media URLs. */
export type PartLearningMeta = {
  id: string;
  order: number;
  difficultyScore: number | null;
  wordCount: number;
  speechDurationMs: number;
};

function mapRowToPartLearningMeta(
  row: Record<string, unknown>,
): PartLearningMeta {
  const speechDurationMs =
    row.speech_duration_ms != null ? Number(row.speech_duration_ms) : null;
  return {
    id: String(row.id),
    order: Number(row.part_order ?? row.order ?? 0),
    difficultyScore:
      row.difficulty_score != null ? Number(row.difficulty_score) : null,
    wordCount: Number(row.word_count ?? 0),
    speechDurationMs: speechDurationMs ?? 0,
  };
}

/** Merge inputs only — preserves caller id order. */
export async function listPartLearningMetaByIds(
  ids: readonly string[],
  db?: DbQueryable,
): Promise<PartLearningMeta[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await execRows<RowDataPacket>(
    `
    SELECT
      id,
      \`order\` AS part_order,
      difficulty_score,
      word_count,
      speech_duration_ms
    FROM parts
    WHERE id IN (${placeholders})
    `,
    [...ids],
    db,
  );
  const byId = new Map(
    rows.map((r) => [
      String(r.id),
      mapRowToPartLearningMeta(r as Record<string, unknown>),
    ]),
  );
  const ordered: PartLearningMeta[] = [];
  for (const id of ids) {
    const part = byId.get(id);
    if (part) ordered.push(part);
  }
  return ordered;
}

/** Full rows for a playlist slice — preserves caller order; skips missing ids. */
export async function listPartsByIds(
  ids: readonly string[],
  db?: DbQueryable,
): Promise<Part[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await execRows<RowDataPacket>(
    `
    SELECT *, \`order\` AS part_order FROM parts
    WHERE id IN (${placeholders})
    `,
    [...ids],
    db,
  );
  const byId = new Map(
    rows.map((r) => [
      String(r.id),
      mapRowToPart(r as Record<string, unknown>),
    ]),
  );
  const ordered: Part[] = [];
  for (const id of ids) {
    const part = byId.get(id);
    if (part) ordered.push(part);
  }
  return ordered;
}

export async function listPartsByEpisodeOrdered(
  episodeId: string,
  db?: DbQueryable,
): Promise<Part[]> {
  const rows = await execRows<RowDataPacket>(
    `
    SELECT *, \`order\` AS part_order FROM parts
    WHERE episode_id = ?
      AND retired_at IS NULL
    ORDER BY \`order\` ASC
    `,
    [episodeId],
    db,
  );
  return rows.map((r) => mapRowToPart(r as Record<string, unknown>));
}

export async function listPartsByVideoOrdered(
  videoId: string,
  db?: DbQueryable,
): Promise<Part[]> {
  const rows = await execRows<RowDataPacket>(
    `
    SELECT p.*, p.\`order\` AS part_order
    FROM parts p
    INNER JOIN episodes e ON e.id = p.episode_id
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE s.video_id = ?
      AND p.retired_at IS NULL
    ORDER BY s.season_num ASC, e.episode_num ASC, p.\`order\` ASC
    `,
    [videoId],
    db,
  );
  return rows.map((r) => mapRowToPart(r as Record<string, unknown>));
}

export async function listPartsForSectionWithTranslations(params: {
  sectionStart: number;
  sectionEnd: number;
  videoId?: string;
  episodeId?: string;
}): Promise<Array<Part & { translations: CaptionTranslation[] }>> {
  const { clause, params: p } = partScopeWhere(
    params.episodeId,
    params.videoId,
  );
  const rows = await execRows<RowDataPacket>(
    `
    SELECT *, \`order\` AS part_order FROM parts
    WHERE ${clause}
      AND \`order\` >= ? AND \`order\` <= ?
    ORDER BY \`order\` ASC
    `,
    [...p, params.sectionStart, params.sectionEnd],
  );
  const parts = rows.map((r) => mapRowToPart(r as Record<string, unknown>));
  const out: Array<Part & { translations: CaptionTranslation[] }> = [];
  for (const p of parts) {
    const tr = await fetchPartTranslations(p.id);
    out.push({ ...p, translations: tr });
  }
  return out;
}

export async function insertPartRecord(params: {
  id?: string;
  text: string;
  videoUrl: string;
  difficulty?: PartDifficulty | number | null;
  difficultyScore?: number | null;
  playbackDurationMs: number;
  order: number;
  episodeId: string;
  playbackStartMs: number;
  playbackEndMs: number;
  hlsManifestUrl?: string | null;
  normalizedText?: string | null;
  wordCount?: number;
  /** Optional Content Pipeline identity — omit to leave NULL. */
  canonicalKey?: string | null;
}): Promise<Part> {
  const id = params.id ?? randomUUID();
  const { difficulty, difficultyScore } = normalizePartDifficultyInput(
    params.difficulty,
  );
  const score =
    params.difficultyScore ?? difficultyScore ?? null;
  const canonicalKey =
    params.canonicalKey === undefined
      ? null
      : mapCanonicalKeyFromDb(params.canonicalKey);
  await pool.execute<ResultSetHeader>(
    `
    INSERT INTO parts (
      id, episode_id, \`order\`, canonical_key, text, video_url,
      difficulty, difficulty_score, duration_ms, start_ms, end_ms,
      hls_manifest_url, normalized_text, word_count, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
    `,
    [
      id,
      params.episodeId,
      params.order,
      canonicalKey,
      params.text,
      params.videoUrl,
      difficulty,
      score,
      params.playbackDurationMs,
      params.playbackStartMs,
      params.playbackEndMs,
      params.hlsManifestUrl ?? null,
      params.normalizedText ?? null,
      params.wordCount ?? 0,
    ],
  );
  const row = await execOne<RowDataPacket>(
    `SELECT *, \`order\` AS part_order FROM parts WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!row) throw new Error("insertPartRecord: missing row");
  return mapRowToPart(row as Record<string, unknown>);
}

export async function deletePartByPk(id: string): Promise<boolean> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `DELETE FROM parts WHERE id = ?`,
    [id],
  );
  return hdr.affectedRows > 0;
}

export async function deletePartsWhereVideoId(videoId: string): Promise<number> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `
    DELETE p FROM parts p
    INNER JOIN episodes e ON e.id = p.episode_id
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE s.video_id = ?
    `,
    [videoId],
  );
  return hdr.affectedRows;
}

/** Delete episode parts whose `order` exceeds `gtOrder` (split --clean trailing slots). */
export async function deletePartsForEpisodeOrderGreaterThan(
  episodeId: string,
  gtOrder: number,
): Promise<number> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `
    DELETE FROM parts
    WHERE episode_id = ? AND \`order\` > ?
    `,
    [episodeId, gtOrder],
  );
  return hdr.affectedRows;
}

/** Delete parts on a video's primary episode with `order` > gt (movie/documentary pipeline). */
export async function deleteStandalonePartsForVideoOrderGreaterThan(
  videoId: string,
  gtOrder: number,
): Promise<number> {
  const { episodeId } = await ensureCanonicalShellForVideo(videoId);
  return deletePartsForEpisodeOrderGreaterThan(episodeId, gtOrder);
}

export async function updatePartTextById(
  id: string,
  text: string,
): Promise<boolean> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `UPDATE parts SET text = ? WHERE id = ?`,
    [text, id],
  );
  return hdr.affectedRows > 0;
}

/** @deprecated Use `updatePartTextById`. */
export const updatePartCaptionById = updatePartTextById;

export async function updatePartDifficultyById(
  id: string,
  difficulty: PartDifficulty,
  difficultyScore?: number | null,
): Promise<boolean> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `
    UPDATE parts
    SET difficulty = ?, difficulty_score = ?
    WHERE id = ?
    `,
    [difficulty, difficultyScore ?? null, id],
  );
  return hdr.affectedRows > 0;
}

export async function updatePartsUrlByEpisodeAndOrder(
  episodeId: string,
  order: number,
  url: string,
): Promise<number> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `
    UPDATE parts SET video_url = ?
    WHERE episode_id = ? AND \`order\` = ?
    `,
    [url, episodeId, order],
  );
  return hdr.affectedRows;
}

export async function updatePartsUrlByVideoStandaloneOrder(
  videoId: string,
  order: number,
  url: string,
): Promise<number> {
  const { episodeId } = await ensureCanonicalShellForVideo(videoId);
  return updatePartsUrlByEpisodeAndOrder(episodeId, order, url);
}

export async function findFirstPartByVideoAnyEpisodeNull(
  videoId: string,
  order: number,
): Promise<Part | null> {
  const { episodeId } = await ensureCanonicalShellForVideo(videoId);
  const row = await execOne<RowDataPacket>(
    `
    SELECT *, \`order\` AS part_order FROM parts
    WHERE episode_id = ? AND \`order\` = ?
    LIMIT 1
    `,
    [episodeId, order],
  );
  return row ? mapRowToPart(row as Record<string, unknown>) : null;
}

export async function updatePartUrlById(
  id: string,
  videoUrl: string,
): Promise<boolean> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `UPDATE parts SET video_url = ? WHERE id = ?`,
    [videoUrl, id],
  );
  return hdr.affectedRows > 0;
}

export async function updatePartsHlsManifestByEpisodeAndOrder(
  episodeId: string,
  order: number,
  hlsManifestUrl: string,
): Promise<number> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `
    UPDATE parts SET hls_manifest_url = ?
    WHERE episode_id = ? AND \`order\` = ?
    `,
    [hlsManifestUrl, episodeId, order],
  );
  return hdr.affectedRows;
}

export async function updatePartsHlsManifestByVideoStandaloneOrder(
  videoId: string,
  order: number,
  hlsManifestUrl: string,
): Promise<number> {
  const { episodeId } = await ensureCanonicalShellForVideo(videoId);
  return updatePartsHlsManifestByEpisodeAndOrder(
    episodeId,
    order,
    hlsManifestUrl,
  );
}

export async function updatePartHlsManifestById(
  id: string,
  hlsManifestUrl: string,
): Promise<boolean> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `UPDATE parts SET hls_manifest_url = ? WHERE id = ?`,
    [hlsManifestUrl, id],
  );
  return hdr.affectedRows > 0;
}

export async function listPartsForEpisodeIncludingRetired(
  episodeId: string,
): Promise<Part[]> {
  const rows = await execRows<RowDataPacket>(
    `
    SELECT *, \`order\` AS part_order
    FROM parts
    WHERE episode_id = ?
    ORDER BY \`order\` ASC
    `,
    [episodeId],
  );
  return rows.map((r) => mapRowToPart(r as Record<string, unknown>));
}

export async function episodeExistsById(episodeId: string): Promise<boolean> {
  const row = await execOne<RowDataPacket>(
    `SELECT id FROM episodes WHERE id = ? LIMIT 1`,
    [episodeId],
  );
  return row != null;
}

export async function updatePartCanonicalKeyById(
  id: string,
  canonicalKey: string | null,
): Promise<boolean> {
  const [hdr] = await pool.execute<ResultSetHeader>(
    `UPDATE parts SET canonical_key = ? WHERE id = ?`,
    [mapCanonicalKeyFromDb(canonicalKey), id],
  );
  return hdr.affectedRows > 0;
}

export async function fetchPartRowById(partId: string): Promise<Part | null> {
  const row = await execOne<RowDataPacket>(
    `SELECT *, \`order\` AS part_order FROM parts WHERE id = ? LIMIT 1`,
    [partId],
  );
  return row ? mapRowToPart(row as Record<string, unknown>) : null;
}

/**
 * Episode-scoped Content Pipeline identity lookup.
 * Returns zero or more parts — duplicate canonical keys are allowed.
 */
export async function findPartsByCanonicalKey(params: {
  episodeId: string;
  canonicalKey: string;
}): Promise<Part[]> {
  const key = mapCanonicalKeyFromDb(params.canonicalKey);
  if (!key) return [];
  const rows = await execRows<RowDataPacket>(
    `
    SELECT *, \`order\` AS part_order
    FROM parts
    WHERE episode_id = ? AND canonical_key = ?
    ORDER BY \`order\` ASC
    `,
    [params.episodeId, key],
  );
  return rows.map((r) => mapRowToPart(r as Record<string, unknown>));
}

/**
 * Global lookup by Content Pipeline identity (no episode scope).
 * Prefer {@link findPartsByCanonicalKey} when episodeId is known.
 */
export async function findPartsByCanonicalKeyGlobal(
  canonicalKey: string,
): Promise<Part[]> {
  const key = mapCanonicalKeyFromDb(canonicalKey);
  if (!key) return [];
  const rows = await execRows<RowDataPacket>(
    `
    SELECT *, \`order\` AS part_order
    FROM parts
    WHERE canonical_key = ?
    ORDER BY episode_id ASC, \`order\` ASC
    `,
    [key],
  );
  return rows.map((r) => mapRowToPart(r as Record<string, unknown>));
}

export async function fetchPartScopeForFinishEpisode(
  partId: string,
): Promise<{
  order: number;
  episodeId: string;
  resolvedVideoId: string | null;
} | null> {
  type R = RowDataPacket & {
    part_order: number;
    episode_id: string;
    season_video_id: string | null;
  };
  const row = await execOne<R>(
    `
    SELECT
      p.\`order\` AS part_order,
      CAST(p.episode_id AS CHAR) AS episode_id,
      CAST(s.video_id AS CHAR) AS season_video_id
    FROM parts p
    INNER JOIN episodes e ON e.id = p.episode_id
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE p.id = ?
    LIMIT 1
    `,
    [partId],
  );
  if (!row) return null;
  return {
    order: Number(row.part_order),
    episodeId: String(row.episode_id),
    resolvedVideoId: String(row.season_video_id),
  };
}

export async function findCaptionTranslation(
  partId: string,
  language: string,
): Promise<CaptionTranslation | null> {
  const row = await execOne<RowDataPacket>(
    `
    SELECT * FROM caption_translations
    WHERE part_id = ? AND language = ?
    LIMIT 1
    `,
    [partId, language],
  );
  return row ? mapRowToCaption(row as Record<string, unknown>) : null;
}

export async function upsertCaptionTranslation(params: {
  partId: string;
  language: string;
  text: string;
  provider?: string | null;
  providerModel?: string | null;
  translatedSentencesJson?: string | null;
}): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `
    INSERT INTO caption_translations (
      part_id, language, text, provider, provider_model, translated_sentences
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      text = VALUES(text),
      provider = VALUES(provider),
      provider_model = VALUES(provider_model),
      translated_sentences = VALUES(translated_sentences)
    `,
    [
      params.partId,
      params.language,
      params.text,
      params.provider ?? null,
      params.providerModel ?? null,
      params.translatedSentencesJson ?? null,
    ],
  );
}

export async function fetchPartVocabularyContext(partId: string): Promise<{
  part: Part;
  translations: CaptionTranslation[];
  directVideo: VideoScalars | null;
  episode: (Episode & {
    season: Season & { video: VideoScalars };
  }) | null;
} | null> {
  const part = await fetchPartRowById(partId);
  if (!part) return null;
  const translations = await fetchPartTranslations(partId);

  const directVideo: VideoScalars | null = null;

  let episodeNest: {
    episode: Episode;
    season: Season;
    seriesVideo: VideoScalars;
  } | null = null;

  if (part.episodeId) {
    const epRow = await execOne<RowDataPacket>(
      `SELECT * FROM episodes WHERE id = ? LIMIT 1`,
      [part.episodeId],
    );
    if (epRow) {
      const ep = mapRowToEpisode(epRow as Record<string, unknown>);
      const sRow = await execOne<RowDataPacket>(
        `SELECT * FROM seasons WHERE id = ? LIMIT 1`,
        [ep.seasonId],
      );
      if (sRow) {
        const season = mapRowToSeason(sRow as Record<string, unknown>);
        const sv = await fetchVideoScalarsById(season.videoId);
        if (sv) {
          episodeNest = { episode: ep, season, seriesVideo: sv };
        }
      }
    }
  }

  const episode =
    episodeNest &&
    ({
      ...episodeNest.episode,
      season: {
        ...episodeNest.season,
        video: episodeNest.seriesVideo,
      },
    } as Episode & { season: Season & { video: VideoScalars } });

  return { part, translations, directVideo, episode: episode ?? null };
}

export async function loadMovieWithParts(
  videoId: string,
): Promise<(VideoScalars & { parts: Part[] }) | null> {
  return loadStandaloneVideoWithParts(videoId);
}

export async function loadStandaloneVideoWithParts(
  videoId: string,
): Promise<(VideoScalars & { parts: Part[] }) | null> {
  const v = await fetchVideoScalarsById(videoId);
  if (!v || !isStandaloneVideoType(v.type)) return null;
  await ensureCanonicalShellForVideo(videoId);
  const parts = await listPartsByVideoOrdered(videoId);
  return { ...v, parts };
}

export async function fetchStandaloneVideoLeanMeta(
  videoId: string,
): Promise<{ id: string; type: VideoType; name: string } | null> {
  type R = RowDataPacket & {
    id: string;
    type: VideoType;
    name: string;
  };
  const row = await execOne<R>(
    `
    SELECT CAST(id AS CHAR) AS id, type, name
    FROM videos
    WHERE id = ? AND type IN ('movie', 'documentary')
    LIMIT 1
    `,
    [videoId],
  );
  return row
    ? { id: String(row.id), type: row.type, name: String(row.name) }
    : null;
}

export type EpisodeWithPartsSeasonVideo = Omit<Episode, "parts"> & {
  parts: Part[];
  season: Omit<Season, "episodes" | "_count"> & {
    video: VideoScalars;
  };
};

export async function loadEpisodeWithPartsSeasonVideo(
  episodeId: string,
): Promise<EpisodeWithPartsSeasonVideo | null> {
  const ep = await fetchEpisodeById(episodeId);
  if (!ep) return null;
  const season = await fetchSeasonById(ep.seasonId);
  if (!season) return null;
  const video = await fetchVideoScalarsById(season.videoId);
  if (!video) return null;
  const parts = await listPartsByEpisodeOrdered(episodeId);
  return {
    ...ep,
    parts,
    season: {
      ...season,
      video,
    },
  };
}

export async function fetchVideoSeasonShellLearn(
  videoId: string,
  seasonId: string,
): Promise<{ id: string } | null> {
  type R = RowDataPacket & { vid: string };
  const row = await execOne<R>(
    `
    SELECT CAST(v.id AS CHAR) AS vid
    FROM videos v
    INNER JOIN seasons s ON s.video_id = v.id AND s.id = ?
    WHERE v.id = ?
    LIMIT 1
    `,
    [seasonId, videoId],
  );
  return row ? { id: String(row.vid) } : null;
}

export async function loadVideoWithSeasonsAscending(
  videoId: string,
): Promise<(VideoScalars & { seasons: Season[] }) | null> {
  const v = await fetchVideoScalarsById(videoId);
  if (!v) return null;
  const seasons = await listSeasonsAscByVideoId(videoId);
  return { ...v, seasons };
}

export async function loadVideoScopedSeasonWithEpisodes(
  videoId: string,
  seasonId: string,
): Promise<
  | (VideoScalars & {
      seasons: Array<
        Season & {
          episodes: Episode[];
        }
      >;
    })
  | null
> {
  const v = await fetchVideoScalarsById(videoId);
  if (!v) return null;
  const seasonRows = await listSeasonsAscByVideoId(videoId);
  const target = seasonRows.find((s) => s.id === seasonId);
  if (!target) return null;
  const episodes = await listEpisodesAscBySeasonId(seasonId);
  return {
    ...v,
    seasons: [{ ...target, episodes }],
  };
}

export async function loadSeasonsWithEpisodesForVideo(
  videoId: string,
): Promise<Array<Season & { episodes: Episode[] }>> {
  const seasons = await listSeasonsAscByVideoId(videoId);
  const out: Array<Season & { episodes: Episode[] }> = [];
  for (const s of seasons) {
    const eps = await listEpisodesAscBySeasonId(s.id);
    out.push({ ...s, episodes: eps });
  }
  return out;
}

export async function loadSeasonsNestedEpisodesParts(
  videoId: string,
): Promise<
  Array<
    Season & {
      episodes: Array<Episode & { parts: Part[] }>;
    }
  >
> {
  const seasons = await listSeasonsAscByVideoId(videoId);
  const out: Array<
    Season & { episodes: Array<Episode & { parts: Part[] }> }
  > = [];
  for (const s of seasons) {
    const epsWith = await listEpisodesWithPartsBySeasonId(s.id);
    out.push({ ...s, episodes: epsWith });
  }
  return out;
}

export async function loadSeasonWithEpisodesAndPartsGraph(
  seasonId: string,
): Promise<
  | (Season & {
      video: VideoScalars;
      episodes: Array<Episode & { parts: Part[] }>;
    })
  | null
> {
  const s = await fetchSeasonById(seasonId);
  if (!s) return null;
  const video = await fetchVideoScalarsById(s.videoId);
  if (!video) return null;
  const episodes = await listEpisodesWithPartsBySeasonId(seasonId);
  return { ...s, video, episodes };
}

export async function fetchSeriesListVideos(): Promise<Video[]> {
  const rows = await execRows<RowDataPacket>(
    `SELECT * FROM videos WHERE type = 'series' ORDER BY created_at DESC`,
    [],
  );
  const out: Video[] = [];
  for (const vr of rows) {
    const base = mapRowToVideoScalars(vr as Record<string, unknown>);
    const seasonRows = await execRows<RowDataPacket>(
      `
      SELECT s.*,
        (SELECT COUNT(*) FROM episodes e WHERE e.season_id = s.id) AS ep_count
      FROM seasons s
      WHERE s.video_id = ?
      ORDER BY s.season_num ASC
      `,
      [base.id],
    );
    const seasons = seasonRows.map((sr) => {
      const sn = mapRowToSeason(sr as Record<string, unknown>);
      return {
        ...sn,
        _count: {
          episodes: Number((sr as Record<string, unknown>).ep_count),
        },
      };
    });
    out.push({ ...base, seasons });
  }
  return out;
}

export async function findVideoByNameAndType(
  name: string,
  type: VideoType,
): Promise<VideoScalars | null> {
  const row = await execOne<RowDataPacket>(
    `SELECT * FROM videos WHERE name = ? AND type = ? LIMIT 1`,
    [name, type],
  );
  return row ? mapRowToVideoScalars(row as Record<string, unknown>) : null;
}

export type UpsertPartPayload = {
  order: number;
  text: string;
  videoUrl: string;
  difficulty?: PartDifficulty | number | null;
  difficultyScore?: number | null;
  playbackDurationMs: number;
  playbackStartMs: number;
  playbackEndMs: number;
  /**
   * When provided, writes `canonical_key`. When omitted, existing key is left
   * unchanged on UPDATE and NULL on INSERT.
   */
  canonicalKey?: string | null;
};

export async function upsertPartForEpisodeOrder(
  params: UpsertPartPayload & { episodeId: string },
): Promise<void> {
  const { difficulty, difficultyScore } = normalizePartDifficultyInput(
    params.difficulty,
  );
  const score = params.difficultyScore ?? difficultyScore ?? null;
  const existing = await execOne<RowDataPacket>(
    `
    SELECT CAST(id AS CHAR) AS id FROM parts
    WHERE episode_id = ? AND \`order\` = ?
    LIMIT 1
    `,
    [params.episodeId, params.order],
  );
  if (existing) {
    const id = String((existing as Record<string, unknown>).id);
    if (params.canonicalKey !== undefined) {
      await pool.execute<ResultSetHeader>(
        `
        UPDATE parts SET
          text = ?, difficulty = ?, difficulty_score = ?, duration_ms = ?,
          video_url = ?, start_ms = ?, end_ms = ?,
          canonical_key = ?
        WHERE id = ?
        `,
        [
          params.text,
          difficulty,
          score,
          params.playbackDurationMs,
          params.videoUrl,
          params.playbackStartMs,
          params.playbackEndMs,
          mapCanonicalKeyFromDb(params.canonicalKey),
          id,
        ],
      );
    } else {
      await pool.execute<ResultSetHeader>(
        `
        UPDATE parts SET
          text = ?, difficulty = ?, difficulty_score = ?, duration_ms = ?,
          video_url = ?, start_ms = ?, end_ms = ?
        WHERE id = ?
        `,
        [
          params.text,
          difficulty,
          score,
          params.playbackDurationMs,
          params.videoUrl,
          params.playbackStartMs,
          params.playbackEndMs,
          id,
        ],
      );
    }
    return;
  }
  await insertPartRecord({
    episodeId: params.episodeId,
    text: params.text,
    videoUrl: params.videoUrl,
    difficulty,
    difficultyScore: score,
    playbackDurationMs: params.playbackDurationMs,
    order: params.order,
    playbackStartMs: params.playbackStartMs,
    playbackEndMs: params.playbackEndMs,
    canonicalKey: params.canonicalKey,
  });
}

export async function upsertPartForVideoStandaloneOrder(
  params: UpsertPartPayload & { videoId: string },
): Promise<void> {
  const { episodeId } = await ensureCanonicalShellForVideo(params.videoId);
  await upsertPartForEpisodeOrder({ ...params, episodeId });
}

export async function listStandaloneMoviePartPairsForVideos(
  videoIds: string[],
): Promise<Array<{ id: string; videoId: string }>> {
  if (videoIds.length === 0) return [];
  const ph = videoIds.map(() => "?").join(", ");
  type R = RowDataPacket & { id: string; video_id: string };
  const rows = await execRows<R>(
    `
    SELECT CAST(pc.part_id AS CHAR) AS id, CAST(pc.video_id AS CHAR) AS video_id
    FROM part_catalog pc
    WHERE pc.video_id IN (${ph})
    `,
    videoIds as SqlScalar[],
  );
  return rows.map((r) => ({ id: String(r.id), videoId: String(r.video_id) }));
}

export type SeriesLibraryPartRow = {
  id: string;
  order: number;
  episodeId: string | null;
  seriesVideoId: string;
};

export async function listSeriesLibraryPartRows(
  videoIds: string[],
): Promise<SeriesLibraryPartRow[]> {
  if (videoIds.length === 0) return [];
  const ph = videoIds.map(() => "?").join(", ");
  type R = RowDataPacket & {
    id: string;
    ord: number;
    episode_id: string | null;
    series_video_id: string | null;
  };
  const rows = await execRows<R>(
    `
    SELECT
      CAST(p.id AS CHAR) AS id,
      p.\`order\` AS ord,
      CAST(p.episode_id AS CHAR) AS episode_id,
      CAST(s.video_id AS CHAR) AS series_video_id
    FROM parts p
    INNER JOIN episodes e ON e.id = p.episode_id
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE s.video_id IN (${ph})
    `,
    videoIds as SqlScalar[],
  );
  const out: SeriesLibraryPartRow[] = [];
  for (const r of rows) {
    if (!r.series_video_id) continue;
    out.push({
      id: String(r.id),
      order: Number(r.ord),
      episodeId: r.episode_id ? String(r.episode_id) : null,
      seriesVideoId: String(r.series_video_id),
    });
  }
  return out;
}
