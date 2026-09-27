import type { UserId } from "@/types/schema";
import type { VideoType } from "@/types/video";
/**
 * Reads/writes `user_part_progress` (snake_case DDL).
 */
import { pool } from "@/lib/db/connection";
import {
  JOIN_VIDEO_ON_CATALOG,
  PART_JOIN_PART_CATALOG,
  USER_PROGRESS_JOIN_PART_CATALOG,
} from "@/lib/db/sql/partCatalog";
import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

type SqlScalar = string | number | boolean | Date | bigint | Buffer | null;

function ph(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

export type UserPartProgressCamel = {
  id: number;
  userId: UserId;
  partId: string;
  attempts: number;
  wrongMoves: number;
  bestScore: number;
  lastScore: number;
  accuracy: number | null;
  speed: number | null;
  durationSec: number | null;
  completedAt: Date | null;
  lastAttemptAt: Date;
  lastSentenceInputMode: "drag" | "voice" | null;
  /** Cumulative XP awarded for this clip (incremented on each scored completion). */
  xpEarned: number;
};

function normalizeSqlId(value: unknown): string {
  return String(value ?? "").trim();
}

function mapRowToCamel(
  r: RowDataPacket & Record<string, unknown>,
): UserPartProgressCamel {
  return {
    id: Number(r.id),
    userId: normalizeSqlId(r.user_id),
    partId: normalizeSqlId(r.part_id),
    attempts: Number(r.attempts),
    wrongMoves: Number(r.wrong_moves ?? 0),
    bestScore: Number(r.best_score),
    lastScore: Number(r.last_score),
    accuracy: r.accuracy != null ? Number(r.accuracy) : null,
    speed: r.speed != null ? Number(r.speed) : null,
    durationSec: r.duration_sec != null ? Number(r.duration_sec) : null,
    completedAt: r.completed_at != null ? (r.completed_at as Date) : null,
    lastAttemptAt: r.last_attempt_at as Date,
    lastSentenceInputMode:
      r.last_sentence_input_mode === "voice" ||
      r.last_sentence_input_mode === "drag"
        ? r.last_sentence_input_mode
        : null,
    xpEarned: Number(r.xp_earned ?? 0),
  };
}

export async function listCompletedPartIdsAmong(
  userId: UserId,
  partIds: string[],
): Promise<string[]> {
  if (partIds.length === 0) return [];
  type R = RowDataPacket & { part_id: string };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT CAST(part_id AS CHAR) AS part_id
    FROM user_part_progress
    WHERE user_id = ?
      AND completed_at IS NOT NULL
      AND part_id IN (${ph(partIds.length)})
    `,
    [userId, ...partIds] as SqlScalar[],
  );
  return rows.map((x) => String(x.part_id));
}

/** Section unlock / completion — requires a scored completion, not skip-only rows. */
export async function listQualifiedCompletePartIdsAmong(
  userId: UserId,
  partIds: string[],
): Promise<string[]> {
  if (partIds.length === 0) return [];
  type R = RowDataPacket & { part_id: string };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT CAST(part_id AS CHAR) AS part_id
    FROM user_part_progress
    WHERE user_id = ?
      AND completed_at IS NOT NULL
      AND best_score > 0
      AND part_id IN (${ph(partIds.length)})
    `,
    [userId, ...partIds] as SqlScalar[],
  );
  return rows.map((x) => String(x.part_id));
}

export type UserPartProgressSlice = {
  partId: string;
  bestScore: number;
  lastScore: number;
  attempts: number;
  wrongMoves: number;
  accuracy: number | null;
  speed: number | null;
  completedAt: Date | null;
  lastSentenceInputMode: "drag" | "voice" | null;
  sessionSectionIndex: number | null;
  visibleUnitStep: number | null;
  xpEarned: number;
};

export async function listProgressSliceForParts(
  userId: UserId,
  partIds: string[],
): Promise<UserPartProgressSlice[]> {
  if (partIds.length === 0) return [];
  type R = RowDataPacket & {
    part_id: string;
    best_score: number;
    last_score: number;
    attempts: number;
    wrong_moves: number;
    accuracy: number | null;
    speed: number | null;
    completed_at: Date | null;
    last_sentence_input_mode: string | null;
    session_section_index: number | null;
    visible_unit_step: number | null;
    xp_earned: number;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      CAST(part_id AS CHAR) AS part_id,
      best_score,
      last_score,
      attempts,
      wrong_moves,
      accuracy,
      speed,
      completed_at,
      last_sentence_input_mode,
      session_section_index,
      visible_unit_step,
      xp_earned
    FROM user_part_progress
    WHERE user_id = ? AND part_id IN (${ph(partIds.length)})
    `,
    [userId, ...partIds] as SqlScalar[],
  );
  return rows.map((r) => ({
    partId: String(r.part_id),
    bestScore: Number(r.best_score),
    lastScore: Number(r.last_score),
    attempts: Number(r.attempts),
    wrongMoves: Number(r.wrong_moves ?? 0),
    accuracy: r.accuracy != null ? Number(r.accuracy) : null,
    speed: r.speed != null ? Number(r.speed) : null,
    completedAt: r.completed_at,
    lastSentenceInputMode:
      r.last_sentence_input_mode === "voice" ||
      r.last_sentence_input_mode === "drag"
        ? r.last_sentence_input_mode
        : null,
    sessionSectionIndex:
      r.session_section_index != null && Number(r.session_section_index) >= 1
        ? Number(r.session_section_index)
        : null,
    visibleUnitStep:
      r.visible_unit_step != null && Number(r.visible_unit_step) >= 1
        ? Number(r.visible_unit_step)
        : null,
    xpEarned: Number(r.xp_earned ?? 0),
  }));
}

export async function countCompletedAmongParts(
  userId: UserId,
  partIds: string[],
): Promise<number> {
  if (partIds.length === 0) return 0;
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c
    FROM user_part_progress
    WHERE user_id = ?
      AND completed_at IS NOT NULL
      AND part_id IN (${ph(partIds.length)})
    `,
    [userId, ...partIds] as SqlScalar[],
  );
  const row = rows[0];
  return row ? Number(row.c) : 0;
}

export async function countQualifiedCompletedPartsForUser(
  userId: UserId,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c
    FROM user_part_progress
    WHERE user_id = ?
      AND completed_at IS NOT NULL
      AND best_score > 0
    `,
    [userId],
  );
  return Number(rows[0]?.c ?? 0);
}

export async function countQualifiedCompleteAmongParts(
  userId: UserId,
  partIds: string[],
): Promise<number> {
  if (partIds.length === 0) return 0;
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c
    FROM user_part_progress
    WHERE user_id = ?
      AND completed_at IS NOT NULL
      AND best_score > 0
      AND part_id IN (${ph(partIds.length)})
    `,
    [userId, ...partIds] as SqlScalar[],
  );
  const row = rows[0];
  return row ? Number(row.c) : 0;
}

export async function fetchCompletedAtForUserPart(
  userId: UserId,
  partId: string,
): Promise<Date | null> {
  type R = RowDataPacket & { completed_at: Date | null };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT completed_at
    FROM user_part_progress
    WHERE user_id = ? AND part_id = ?
    LIMIT 1
    `,
    [userId, partId],
  );
  const r = rows[0];
  return r?.completed_at ?? null;
}

async function fetchUserPartProgressRowOnConnection(
  conn: PoolConnection,
  userId: UserId,
  partId: string,
): Promise<UserPartProgressCamel | null> {
  const uid = normalizeSqlId(userId);
  const pid = normalizeSqlId(partId);
  const [rows] = await conn.execute<
    (RowDataPacket & Record<string, unknown>)[]
  >(
    `
    SELECT *
    FROM user_part_progress
    WHERE CAST(user_id AS CHAR) = ? AND CAST(part_id AS CHAR) = ?
    LIMIT 1
    `,
    [uid, pid],
  );
  const r = rows[0];
  return r ? mapRowToCamel(r) : null;
}

async function fetchUserPartProgressRowByIdOnConnection(
  conn: PoolConnection,
  progressId: number,
  userId: UserId,
): Promise<UserPartProgressCamel | null> {
  const [rows] = await conn.execute<
    (RowDataPacket & Record<string, unknown>)[]
  >(`SELECT * FROM user_part_progress WHERE id = ? AND user_id = ? LIMIT 1`, [
    progressId,
    normalizeSqlId(userId),
  ]);

  const r = rows[0];
  return r ? mapRowToCamel(r) : null;
}

export async function fetchUserPartProgressRow(
  userId: UserId,
  partId: string,
): Promise<UserPartProgressCamel | null> {
  const conn = await pool.getConnection();
  try {
    return await fetchUserPartProgressRowOnConnection(conn, userId, partId);
  } finally {
    conn.release();
  }
}

export async function upsertUserPartProgress(params: {
  userId: UserId;
  partId: string;
  attempts: number;
  wrongMoves: number;
  lastScore: number;
  bestScore: number;
  accuracy: number | null;
  speed: number | null;
  durationSec: number | null;
  lastAttemptAt: Date;
  completedAt: Date | null;
  lastSentenceInputMode?: "drag" | "voice";
  /** Learner-visible section at completion (null = leave existing / unset). */
  sessionSectionIndex?: number | null;
  /** Learner-visible unit step at completion (null = leave existing / unset). */
  visibleUnitStep?: number | null;
  xpEarned?: number;
}): Promise<UserPartProgressCamel> {
  const userId = normalizeSqlId(params.userId);
  const partId = normalizeSqlId(params.partId);
  const mode = params.lastSentenceInputMode ?? null;
  const sessionSectionIndex =
    params.sessionSectionIndex != null &&
    Number.isFinite(params.sessionSectionIndex) &&
    params.sessionSectionIndex >= 1
      ? Math.trunc(params.sessionSectionIndex)
      : null;
  const visibleUnitStep =
    params.visibleUnitStep != null &&
    Number.isFinite(params.visibleUnitStep) &&
    params.visibleUnitStep >= 1
      ? Math.trunc(params.visibleUnitStep)
      : null;
  const conn = await pool.getConnection();

  try {
    const [result] = await conn.execute<ResultSetHeader>(
      `
      INSERT INTO user_part_progress (
        user_id, part_id, attempts, wrong_moves, best_score, last_score,
        accuracy, speed, duration_sec, completed_at, last_attempt_at,
        last_sentence_input_mode, session_section_index, visible_unit_step,
        xp_earned
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        attempts = VALUES(attempts),
        wrong_moves = VALUES(wrong_moves),
        last_score = VALUES(last_score),
        best_score = VALUES(best_score),
        accuracy = VALUES(accuracy),
        speed = VALUES(speed),
        duration_sec = VALUES(duration_sec),
        completed_at = VALUES(completed_at),
        last_attempt_at = VALUES(last_attempt_at),
        last_sentence_input_mode = VALUES(last_sentence_input_mode),
        session_section_index = COALESCE(
          VALUES(session_section_index),
          session_section_index
        ),
        visible_unit_step = COALESCE(
          VALUES(visible_unit_step),
          visible_unit_step
        ),
        xp_earned = VALUES(xp_earned)
      `,
      [
        userId,
        partId,
        params.attempts,
        params.wrongMoves,
        params.bestScore,
        params.lastScore,
        params.accuracy,
        params.speed,
        params.durationSec,
        params.completedAt,
        params.lastAttemptAt,
        mode,
        sessionSectionIndex,
        visibleUnitStep,
        Math.max(0, params.xpEarned ?? 0),
      ] as SqlScalar[],
    );

    const insertId = Number(result.insertId);

    const isInsert = result.affectedRows === 1 && insertId > 0;

    const row = isInsert
      ? await fetchUserPartProgressRowByIdOnConnection(conn, insertId, userId)
      : null;
    const resolved =
      row ?? (await fetchUserPartProgressRowOnConnection(conn, userId, partId));

    if (!resolved) {
      throw new Error(
        `upsertUserPartProgress: row missing after upsert (userId=${userId}, partId=${partId}, insertId=${insertId}, affectedRows=${result.affectedRows})`,
      );
    }
    return resolved;
  } finally {
    conn.release();
  }
}

export async function countAttemptsInLocalWindow(
  userId: UserId,
  start: Date,
  endExclusive: Date,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c
    FROM user_part_progress
    WHERE user_id = ?
      AND last_attempt_at >= ?
      AND last_attempt_at < ?
    `,
    [userId, start, endExclusive],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

export type RecentCompletedClipRow = {
  progressId: number;
  partId: string;
  completedAt: Date;
  lastScore: number;
  order: number;
  directVideoName: string | null;
  seriesVideoName: string | null;
  videoType: VideoType;
  videoId: string | null;
  episodeNum: number | null;
  seasonNum: number | null;
  episodeId: string | null;
  /** Persisted learner-visible placement at completion (null = legacy row). */
  sessionSectionIndex: number | null;
  visibleUnitStep: number | null;
};

export async function fetchMostRecentCompletedClip(
  userId: UserId,
): Promise<RecentCompletedClipRow | null> {
  type R = RowDataPacket & {
    progress_id: number;
    part_id: string;
    completed_at: Date;
    last_score: number;
    part_order: number;
    sv_name: string | null;
    video_type: string;
    video_id: string | null;
    episode_num: number | null;
    season_num: number | null;
    part_episode_id: string | null;
    session_section_index: number | null;
    visible_unit_step: number | null;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      upp.id AS progress_id,
      CAST(upp.part_id AS CHAR) AS part_id,
      upp.completed_at AS completed_at,
      upp.last_score AS last_score,
      p.\`order\` AS part_order,
      pc.video_name AS sv_name,
      pc.video_type AS video_type,
      CAST(pc.video_id AS CHAR) AS video_id,
      pc.episode_num AS episode_num,
      pc.season_num AS season_num,
      pc.episode_id AS part_episode_id,
      upp.session_section_index AS session_section_index,
      upp.visible_unit_step AS visible_unit_step
    FROM user_part_progress upp
    INNER JOIN parts p ON p.id = upp.part_id
    ${PART_JOIN_PART_CATALOG}
    WHERE upp.user_id = ? AND upp.completed_at IS NOT NULL
    ORDER BY upp.completed_at DESC, p.\`order\` DESC, upp.id DESC
    LIMIT 1
    `,
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    progressId: Number(r.progress_id),
    partId: String(r.part_id),
    completedAt: r.completed_at,
    lastScore: Number(r.last_score),
    order: Number(r.part_order),
    directVideoName: null,
    seriesVideoName: r.sv_name != null ? String(r.sv_name) : null,
    videoType: r.video_type as VideoType,
    videoId: r.video_id != null ? String(r.video_id) : null,
    episodeNum:
      r.episode_num !== null && r.episode_num !== undefined
        ? Number(r.episode_num)
        : null,
    seasonNum:
      r.season_num !== null && r.season_num !== undefined
        ? Number(r.season_num)
        : null,
    episodeId: r.part_episode_id != null ? String(r.part_episode_id) : null,
    sessionSectionIndex:
      r.session_section_index != null && Number(r.session_section_index) >= 1
        ? Number(r.session_section_index)
        : null,
    visibleUnitStep:
      r.visible_unit_step != null && Number(r.visible_unit_step) >= 1
        ? Number(r.visible_unit_step)
        : null,
  };
}

/** --- Dashboard / analytics --- */

export async function countAllProgressRowsForUser(
  userId: UserId,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `SELECT COUNT(*) AS c FROM user_part_progress WHERE user_id = ?`,
    [userId],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

export async function countCompletedRowsForUser(
  userId: UserId,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c FROM user_part_progress
    WHERE user_id = ? AND completed_at IS NOT NULL
    `,
    [userId],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

export async function countStrongFinishRowsForUser(
  userId: UserId,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c FROM user_part_progress
    WHERE user_id = ? AND best_score >= 88
    `,
    [userId],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

export async function avgBestScoreForUser(
  userId: UserId,
): Promise<number | null> {
  type R = RowDataPacket & { v: number | null };
  const [rows] = await pool.execute<R[]>(
    `SELECT AVG(best_score) AS v FROM user_part_progress WHERE user_id = ?`,
    [userId],
  );
  const v = rows[0]?.v;
  return v != null ? Number(v) : null;
}

export async function sumAttemptsForUser(userId: UserId): Promise<number> {
  type R = RowDataPacket & { v: bigint | null };
  const [rows] = await pool.execute<R[]>(
    `SELECT COALESCE(SUM(attempts), 0) AS v FROM user_part_progress WHERE user_id = ?`,
    [userId],
  );
  return rows[0]?.v != null ? Number(rows[0].v) : 0;
}

export async function avgAccuracyForUser(
  userId: UserId,
): Promise<number | null> {
  type R = RowDataPacket & { v: number | null };
  const [rows] = await pool.execute<R[]>(
    `SELECT AVG(accuracy) AS v FROM user_part_progress WHERE user_id = ?`,
    [userId],
  );
  const v = rows[0]?.v;
  return v != null ? Number(v) : null;
}

/** Average response duration (seconds) over attempts with a positive `duration_sec`. */
export async function avgDurationSecPositiveForUser(
  userId: UserId,
): Promise<number | null> {
  type R = RowDataPacket & { v: number | null };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT AVG(duration_sec) AS v
    FROM user_part_progress
    WHERE user_id = ?
      AND duration_sec IS NOT NULL
      AND duration_sec > 0
    `,
    [userId],
  );
  const v = rows[0]?.v;
  return v != null ? Number(v) : null;
}

export async function listLastAttemptAtSince(
  userId: UserId,
  since: Date,
): Promise<Date[]> {
  type R = RowDataPacket & { last_attempt_at: Date };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT last_attempt_at
    FROM user_part_progress
    WHERE user_id = ? AND last_attempt_at >= ?
    `,
    [userId, since],
  );
  return rows.map((r) => r.last_attempt_at);
}

export async function listLastAttemptAtInRange(
  userId: UserId,
  startInclusive: Date,
  endExclusive: Date,
): Promise<Date[]> {
  type R = RowDataPacket & { last_attempt_at: Date };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT last_attempt_at
    FROM user_part_progress
    WHERE user_id = ?
      AND last_attempt_at >= ?
      AND last_attempt_at < ?
    `,
    [userId, startInclusive, endExclusive],
  );
  return rows.map((r) => r.last_attempt_at);
}

export async function listBestScoresForUser(userId: UserId): Promise<number[]> {
  type R = RowDataPacket & { best_score: number };
  const [rows] = await pool.execute<R[]>(
    `SELECT best_score FROM user_part_progress WHERE user_id = ?`,
    [userId],
  );
  return rows.map((r) => Number(r.best_score));
}

export async function countInputModeVoiceForUser(
  userId: UserId,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c FROM user_part_progress
    WHERE user_id = ? AND last_sentence_input_mode = 'voice'
    `,
    [userId],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

export async function countInputModeDragForUser(
  userId: UserId,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c FROM user_part_progress
    WHERE user_id = ? AND last_sentence_input_mode = 'drag'
    `,
    [userId],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

/** Achievement metric presets (parity with legacy Prisma `count` queries). */

const ACC80 = 0.8;
const ACC90 = 0.9;
const PERF_ACC = 0.95;
const FAST_SEC = 30;

export async function countAchievementMetric(
  userId: UserId,
  preset:
    | "completed_voice"
    | "completed_voice_acc80"
    | "completed_voice_acc90"
    | "completed_voice_fast"
    | "completed_acc80_fast"
    | "completed_fast_duration"
    | "completed_flawless_accuracy",
): Promise<number> {
  let sql = "";
  const params: SqlScalar[] = [userId];
  switch (preset) {
    case "completed_voice":
      sql = `
        SELECT COUNT(*) AS c FROM user_part_progress
        WHERE user_id = ?
          AND completed_at IS NOT NULL
          AND last_sentence_input_mode = 'voice'
      `;
      break;
    case "completed_voice_acc80":
      sql = `
        SELECT COUNT(*) AS c FROM user_part_progress
        WHERE user_id = ?
          AND completed_at IS NOT NULL
          AND last_sentence_input_mode = 'voice'
          AND accuracy >= ?
      `;
      params.push(ACC80);
      break;
    case "completed_voice_acc90":
      sql = `
        SELECT COUNT(*) AS c FROM user_part_progress
        WHERE user_id = ?
          AND completed_at IS NOT NULL
          AND last_sentence_input_mode = 'voice'
          AND accuracy >= ?
      `;
      params.push(ACC90);
      break;
    case "completed_voice_fast":
      sql = `
        SELECT COUNT(*) AS c FROM user_part_progress
        WHERE user_id = ?
          AND completed_at IS NOT NULL
          AND last_sentence_input_mode = 'voice'
          AND duration_sec IS NOT NULL
          AND duration_sec <= ?
      `;
      params.push(FAST_SEC);
      break;
    case "completed_acc80_fast":
      sql = `
        SELECT COUNT(*) AS c FROM user_part_progress
        WHERE user_id = ?
          AND completed_at IS NOT NULL
          AND accuracy >= ?
          AND duration_sec IS NOT NULL
          AND duration_sec <= ?
      `;
      params.push(ACC80, FAST_SEC);
      break;
    case "completed_fast_duration":
      sql = `
        SELECT COUNT(*) AS c FROM user_part_progress
        WHERE user_id = ?
          AND completed_at IS NOT NULL
          AND duration_sec IS NOT NULL
          AND duration_sec <= ?
      `;
      params.push(FAST_SEC);
      break;
    case "completed_flawless_accuracy":
      sql = `
        SELECT COUNT(*) AS c FROM user_part_progress
        WHERE user_id = ?
          AND completed_at IS NOT NULL
          AND accuracy >= ?
      `;
      params.push(PERF_ACC);
      break;
    default:
      return 0;
  }
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(sql, params);
  return rows[0] ? Number(rows[0].c) : 0;
}

export type AchievementAttemptJoinedRow = {
  lastAttemptAt: Date;
  accuracy: number | null;
  lastSentenceInputMode: "drag" | "voice" | null;
  durationSec: number | null;
  completedAt: Date | null;
  partEpisodeId: string | null;
  svId: string | null;
  svType: string | null;
  svGenresRaw: unknown;
};

export async function listAchievementAttemptJoinedRows(
  userId: UserId,
): Promise<AchievementAttemptJoinedRow[]> {
  type R = RowDataPacket & {
    last_attempt_at: Date;
    accuracy: number | null;
    last_sentence_input_mode: string | null;
    duration_sec: number | null;
    completed_at: Date | null;
    part_episode_id: string | null;
    sv_id: string | null;
    sv_type: string | null;
    sv_genres: unknown;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      upp.last_attempt_at,
      upp.accuracy,
      upp.last_sentence_input_mode,
      upp.duration_sec,
      upp.completed_at,
      pc.episode_id AS part_episode_id,
      pc.video_id AS sv_id,
      pc.video_type AS sv_type,
      v.genres AS sv_genres
    FROM user_part_progress upp
    ${USER_PROGRESS_JOIN_PART_CATALOG}
    INNER JOIN videos v ON ${JOIN_VIDEO_ON_CATALOG("pc", "v")}
    WHERE upp.user_id = ?
    `,
    [userId],
  );
  return rows.map((r) => ({
    lastAttemptAt: r.last_attempt_at,
    accuracy: r.accuracy != null ? Number(r.accuracy) : null,
    lastSentenceInputMode:
      r.last_sentence_input_mode === "voice" ||
      r.last_sentence_input_mode === "drag"
        ? r.last_sentence_input_mode
        : null,
    durationSec: r.duration_sec != null ? Number(r.duration_sec) : null,
    completedAt: r.completed_at,
    partEpisodeId: r.part_episode_id != null ? String(r.part_episode_id) : null,
    svId: r.sv_id != null ? String(r.sv_id) : null,
    svType: r.sv_type != null ? String(r.sv_type) : null,
    svGenresRaw: r.sv_genres,
  }));
}

export type AchievementCompletedJoinedRow = {
  partEpisodeId: string | null;
  svId: string | null;
  svType: string | null;
};

export async function listAchievementCompletedJoinedRows(
  userId: UserId,
): Promise<AchievementCompletedJoinedRow[]> {
  type R = RowDataPacket & {
    part_episode_id: string | null;
    sv_id: string | null;
    sv_type: string | null;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      pc.episode_id AS part_episode_id,
      pc.video_id AS sv_id,
      pc.video_type AS sv_type
    FROM user_part_progress upp
    ${USER_PROGRESS_JOIN_PART_CATALOG}
    WHERE upp.user_id = ? AND upp.completed_at IS NOT NULL
    `,
    [userId],
  );
  return rows.map((r) => ({
    partEpisodeId: r.part_episode_id != null ? String(r.part_episode_id) : null,
    svId: r.sv_id != null ? String(r.sv_id) : null,
    svType: r.sv_type != null ? String(r.sv_type) : null,
  }));
}

/** All completed `part_id` values for this user (for episode/movie completeness checks). */
export async function listAllCompletedPartIdsForUser(
  userId: UserId,
): Promise<Set<string>> {
  type R = RowDataPacket & { part_id: string };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT CAST(part_id AS CHAR) AS part_id
    FROM user_part_progress
    WHERE user_id = ? AND completed_at IS NOT NULL
    `,
    [userId],
  );
  return new Set(rows.map((r) => String(r.part_id)));
}

/** Upsert using an existing transactional connection (optional future use). */
export async function upsertUserPartProgressOnConnection(
  conn: PoolConnection,
  params: {
    userId: UserId;
    partId: string;
    attempts: number;
    wrongMoves: number;
    lastScore: number;
    bestScore: number;
    accuracy: number | null;
    speed: number | null;
    durationSec: number | null;
    lastAttemptAt: Date;
    completedAt: Date | null;
    lastSentenceInputMode?: "drag" | "voice";
    sessionSectionIndex?: number | null;
    visibleUnitStep?: number | null;
    xpEarned?: number;
  },
): Promise<void> {
  const mode = params.lastSentenceInputMode ?? null;
  const sessionSectionIndex =
    params.sessionSectionIndex != null &&
    Number.isFinite(params.sessionSectionIndex) &&
    params.sessionSectionIndex >= 1
      ? Math.trunc(params.sessionSectionIndex)
      : null;
  const visibleUnitStep =
    params.visibleUnitStep != null &&
    Number.isFinite(params.visibleUnitStep) &&
    params.visibleUnitStep >= 1
      ? Math.trunc(params.visibleUnitStep)
      : null;
  await conn.execute<ResultSetHeader>(
    `
    INSERT INTO user_part_progress (
      user_id, part_id, attempts, wrong_moves, best_score, last_score,
      accuracy, speed, duration_sec, completed_at, last_attempt_at,
      last_sentence_input_mode, session_section_index, visible_unit_step,
      xp_earned
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      attempts = VALUES(attempts),
      wrong_moves = VALUES(wrong_moves),
      last_score = VALUES(last_score),
      best_score = VALUES(best_score),
      accuracy = VALUES(accuracy),
      speed = VALUES(speed),
      duration_sec = VALUES(duration_sec),
      completed_at = VALUES(completed_at),
      last_attempt_at = VALUES(last_attempt_at),
      last_sentence_input_mode = VALUES(last_sentence_input_mode),
      session_section_index = COALESCE(
        VALUES(session_section_index),
        session_section_index
      ),
      visible_unit_step = COALESCE(
        VALUES(visible_unit_step),
        visible_unit_step
      ),
      xp_earned = VALUES(xp_earned)
    `,
    [
      params.userId,
      params.partId,
      params.attempts,
      params.wrongMoves,
      params.bestScore,
      params.lastScore,
      params.accuracy,
      params.speed,
      params.durationSec,
      params.completedAt,
      params.lastAttemptAt,
      mode,
      sessionSectionIndex,
      visibleUnitStep,
      Math.max(0, params.xpEarned ?? 0),
    ] as SqlScalar[],
  );
}
