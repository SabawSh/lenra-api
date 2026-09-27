import { pool } from "@/lib/db/connection";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { VideoType } from "@/types/video";

import type { UserId } from "@/types/schema";
type SqlScalar =
  | string
  | number
  | boolean
  | Date
  | bigint
  | Buffer
  | null;

function localCalendarDayBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start, end };
}

export async function countUserRemindersDueToday(
  userId: UserId,
): Promise<number> {
  const { start, end } = localCalendarDayBounds();
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c
    FROM user_reminders
    WHERE user_id = ? AND due_at >= ? AND due_at < ?
    `,
    [userId, start, end],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

/** Due-today reminder part ids intersecting `partIds`. */
export async function listDueReminderPartIdsToday(
  userId: UserId,
  partIds: string[],
): Promise<Set<string>> {
  if (partIds.length === 0) return new Set();
  const { start, end } = localCalendarDayBounds();
  const placeholders = partIds.map(() => "?").join(",");
  type R = RowDataPacket & { part_id: string };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT DISTINCT CAST(part_id AS CHAR) AS part_id
    FROM user_reminders
    WHERE user_id = ?
      AND due_at >= ? AND due_at < ?
      AND part_id IN (${placeholders})
    `,
    [userId, start, end, ...partIds] as SqlScalar[],
  );
  return new Set(rows.map((r) => String(r.part_id)));
}

export async function countAllUserReminders(userId: UserId): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `SELECT COUNT(*) AS c FROM user_reminders WHERE user_id = ?`,
    [userId],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

export type DueReminderJoinedRow = {
  id: number;
  dueAt: Date;
  partId: string;
  partOrder: number;
  text: string | null;
  partEpisodeId: string | null;
  svType: VideoType | null;
  seasonId: string | null;
  seasonVideoId: string | null;
};

export async function listUserRemindersDueTodayJoined(
  userId: UserId,
  limit: number,
): Promise<DueReminderJoinedRow[]> {
  const { start, end } = localCalendarDayBounds();
  const lim = Math.min(Math.max(limit, 1), 200);
  type R = RowDataPacket & {
    rid: number;
    due_at: Date;
    pid: string;
    part_order: number;
    caption: string | null;
    part_video_id: string | null;
    part_episode_id: string | null;
    pv_type: string | null;
    sv_type: string | null;
    season_id: string | null;
    season_video_id: string | null;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      ur.id AS rid,
      ur.due_at AS due_at,
      CAST(p.id AS CHAR) AS pid,
      p.\`order\` AS part_order,
      p.text AS text,
      pc.episode_id AS part_episode_id,
      pc.video_type AS sv_type,
      pc.season_id AS season_id,
      pc.video_id AS season_video_id
    FROM user_reminders ur
    INNER JOIN part_catalog pc ON pc.part_id COLLATE utf8mb4_unicode_ci = ur.part_id
    INNER JOIN parts p ON p.id = ur.part_id
    WHERE ur.user_id = ? AND ur.due_at >= ? AND ur.due_at < ?
    ORDER BY ur.due_at ASC
    LIMIT ${lim}
    `,
    [userId, start, end] as SqlScalar[],
  );
  return rows.map((r) => ({
    id: Number(r.rid),
    dueAt: r.due_at,
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

export async function listUserRemindersDueTodayForEpisodeJoined(
  userId: UserId,
  episodeId: string,
): Promise<DueReminderJoinedRow[]> {
  const { start, end } = localCalendarDayBounds();
  type R = RowDataPacket & {
    rid: number;
    due_at: Date;
    pid: string;
    part_order: number;
    caption: string | null;
    part_video_id: string | null;
    part_episode_id: string | null;
    pv_type: string | null;
    sv_type: string | null;
    season_id: string | null;
    season_video_id: string | null;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      ur.id AS rid,
      ur.due_at AS due_at,
      CAST(p.id AS CHAR) AS pid,
      p.\`order\` AS part_order,
      p.text AS text,
      pc.episode_id AS part_episode_id,
      pc.video_type AS sv_type,
      pc.season_id AS season_id,
      pc.video_id AS season_video_id
    FROM user_reminders ur
    INNER JOIN part_catalog pc ON pc.part_id COLLATE utf8mb4_unicode_ci = ur.part_id
    INNER JOIN parts p ON p.id = ur.part_id
    WHERE ur.user_id = ?
      AND ur.due_at >= ? AND ur.due_at < ?
      AND pc.episode_id COLLATE utf8mb4_unicode_ci = ?
    ORDER BY ur.due_at ASC
    `,
    [userId, start, end, episodeId],
  );
  return rows.map((r) => ({
    id: Number(r.rid),
    dueAt: r.due_at,
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

export type ReminderJoinedWithTitle = DueReminderJoinedRow & {
  videoName: string;
  videoType: VideoType;
};

/**
 * Reminders for a local calendar day, optionally filtered to one root title.
 * Reuses part_catalog — no schema changes.
 */
export async function listUserRemindersForDayJoined(params: {
  userId: UserId;
  dayStart: Date;
  dayEnd: Date;
  rootVideoId?: string | null;
  limit?: number;
}): Promise<ReminderJoinedWithTitle[]> {
  const lim = Math.min(Math.max(params.limit ?? 100, 1), 300);
  const args: SqlScalar[] = [
    params.userId,
    params.dayStart,
    params.dayEnd,
  ];
  let titleClause = "";
  if (params.rootVideoId) {
    titleClause = " AND pc.video_id COLLATE utf8mb4_unicode_ci = ?";
    args.push(params.rootVideoId);
  }

  type R = RowDataPacket & {
    rid: number;
    due_at: Date;
    pid: string;
    part_order: number;
    text: string | null;
    part_episode_id: string | null;
    sv_type: string | null;
    season_id: string | null;
    season_video_id: string | null;
    video_name: string | null;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      ur.id AS rid,
      ur.due_at AS due_at,
      CAST(p.id AS CHAR) AS pid,
      p.\`order\` AS part_order,
      p.text AS text,
      pc.episode_id AS part_episode_id,
      pc.video_type AS sv_type,
      pc.season_id AS season_id,
      pc.video_id AS season_video_id,
      pc.video_name AS video_name
    FROM user_reminders ur
    INNER JOIN part_catalog pc ON pc.part_id COLLATE utf8mb4_unicode_ci = ur.part_id
    INNER JOIN parts p ON p.id = ur.part_id
    WHERE ur.user_id = ?
      AND ur.due_at >= ? AND ur.due_at < ?
      ${titleClause}
    ORDER BY ur.due_at ASC, p.\`order\` ASC
    LIMIT ${lim}
    `,
    args,
  );

  return rows.map((r) => {
    const videoType = (r.sv_type as VideoType) || "movie";
    return {
      id: Number(r.rid),
      dueAt: r.due_at,
      partId: String(r.pid),
      partOrder: Number(r.part_order),
      text: r.text != null ? String(r.text) : null,
      partEpisodeId:
        r.part_episode_id != null ? String(r.part_episode_id) : null,
      svType: r.sv_type != null ? (r.sv_type as VideoType) : null,
      seasonId: r.season_id != null ? String(r.season_id) : null,
      seasonVideoId:
        r.season_video_id != null ? String(r.season_video_id) : null,
      videoName: (r.video_name ?? "").trim() || "Untitled",
      videoType,
    };
  });
}

export type ReminderDayCount = {
  /** YYYY-MM-DD in the DB/session timezone used for due_at */
  date: string;
  count: number;
};

/** Per-day counts in a half-open date range (for calendar dots). */
export async function listUserReminderDayCounts(params: {
  userId: UserId;
  rangeStart: Date;
  rangeEnd: Date;
  rootVideoId?: string | null;
}): Promise<ReminderDayCount[]> {
  const args: SqlScalar[] = [
    params.userId,
    params.rangeStart,
    params.rangeEnd,
  ];
  let titleClause = "";
  if (params.rootVideoId) {
    titleClause =
      " AND pc.video_id COLLATE utf8mb4_unicode_ci = ?";
    args.push(params.rootVideoId);
  }

  type R = RowDataPacket & { d: string; c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT DATE_FORMAT(ur.due_at, '%Y-%m-%d') AS d, COUNT(*) AS c
    FROM user_reminders ur
    INNER JOIN part_catalog pc ON pc.part_id COLLATE utf8mb4_unicode_ci = ur.part_id
    WHERE ur.user_id = ?
      AND ur.due_at >= ? AND ur.due_at < ?
      ${titleClause}
    GROUP BY d
    ORDER BY d ASC
    `,
    args,
  );
  return rows.map((r) => ({
    date: String(r.d),
    count: Number(r.c),
  }));
}

export type ReminderTitleOption = {
  videoId: string;
  videoName: string;
  videoType: VideoType;
  count: number;
};

/** Distinct titles that have any reminder for this user (filter chips). */
export async function listUserReminderTitles(
  userId: UserId,
): Promise<ReminderTitleOption[]> {
  type R = RowDataPacket & {
    video_id: string;
    video_name: string | null;
    video_type: string | null;
    c: bigint;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      CAST(pc.video_id AS CHAR) AS video_id,
      pc.video_name AS video_name,
      pc.video_type AS video_type,
      COUNT(*) AS c
    FROM user_reminders ur
    INNER JOIN part_catalog pc ON pc.part_id COLLATE utf8mb4_unicode_ci = ur.part_id
    WHERE ur.user_id = ?
    GROUP BY pc.video_id, pc.video_name, pc.video_type
    ORDER BY c DESC, pc.video_name ASC
    `,
    [userId],
  );
  return rows.map((r) => ({
    videoId: String(r.video_id),
    videoName: (r.video_name ?? "").trim() || "Untitled",
    videoType: (r.video_type as VideoType) || "movie",
    count: Number(r.c),
  }));
}

export type UserReminderCamel = {
  id: number;
  userId: UserId;
  partId: string;
  dueAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export async function getUserReminderByPart(
  userId: UserId,
  partId: string,
): Promise<UserReminderCamel | null> {
  type R = RowDataPacket & {
    id: number;
    user_id: UserId;
    part_id: string;
    due_at: Date;
    created_at: Date;
    updated_at: Date;
  };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT id, user_id, part_id, due_at, created_at, updated_at
    FROM user_reminders
    WHERE user_id = ? AND part_id = ?
    LIMIT 1
    `,
    [userId, partId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    userId: r.user_id,
    partId: String(r.part_id),
    dueAt: r.due_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function upsertUserReminderByPart(
  userId: UserId,
  partId: string,
  dueAt: Date,
): Promise<UserReminderCamel> {
  await pool.execute<ResultSetHeader>(
    `
    INSERT INTO user_reminders (user_id, part_id, due_at)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      due_at = VALUES(due_at),
      updated_at = CURRENT_TIMESTAMP(3)
    `,
    [userId, partId, dueAt],
  );
  const row = await getUserReminderByPart(userId, partId);
  if (!row) throw new Error("upsertUserReminderByPart: row missing");
  return row;
}
