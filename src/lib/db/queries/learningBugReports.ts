import { pool } from "@/lib/db/connection";
import {
  type AdminLearningBugReportRow,
  type LearningBugReportCategory,
  type LearningBugReportStatus,
} from "@/lib/learning/bugReports";
import type { UserId } from "@/types/schema";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

let hasLearningBugReportStatusColumnCache: boolean | null = null;

async function hasLearningBugReportStatusColumn(): Promise<boolean> {
  if (hasLearningBugReportStatusColumnCache != null) {
    return hasLearningBugReportStatusColumnCache;
  }

  type ColumnRow = RowDataPacket & { has_col: number };
  const [rows] = await pool.query<ColumnRow[]>(
    `
      SELECT COUNT(*) AS has_col
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'learning_bug_reports'
        AND COLUMN_NAME = 'status'
    `,
  );
  hasLearningBugReportStatusColumnCache = Number(rows[0]?.has_col ?? 0) > 0;
  return hasLearningBugReportStatusColumnCache;
}

export type InsertLearningBugReportInput = {
  userId: UserId;
  partId?: string | null;
  videoId?: string | null;
  episodeId?: string | null;
  seasonId?: string | null;
  sectionIndex?: number | null;
  step?: number | null;
  category: LearningBugReportCategory;
  message?: string | null;
  pageUrl?: string | null;
  userAgent?: string | null;
};

export async function insertLearningBugReport(
  input: InsertLearningBugReportInput,
): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `
    INSERT INTO learning_bug_reports (
      user_id,
      part_id,
      video_id,
      episode_id,
      season_id,
      section_index,
      step,
      category,
      message,
      page_url,
      user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.userId,
      input.partId ?? null,
      input.videoId ?? null,
      input.episodeId ?? null,
      input.seasonId ?? null,
      input.sectionIndex ?? null,
      input.step ?? null,
      input.category,
      input.message ?? null,
      input.pageUrl ?? null,
      input.userAgent ?? null,
    ],
  );

  return result.insertId;
}

export async function listLearningBugReportsForAdmin(params?: {
  query?: string;
  category?: LearningBugReportCategory | "all";
  status?: LearningBugReportStatus | "all";
  limit?: number;
}): Promise<AdminLearningBugReportRow[]> {
  const rawQuery = params?.query?.trim() ?? "";
  const category = params?.category ?? "all";
  const status = params?.status ?? "all";
  const limit = Math.max(1, Math.min(params?.limit ?? 100, 250));
  const hasStatusColumn = await hasLearningBugReportStatusColumn();

  const where: string[] = [];
  const values: Array<string> = [];

  if (category !== "all") {
    where.push("r.category = ?");
    values.push(category);
  }

  if (status !== "all" && hasStatusColumn) {
    where.push("r.status = ?");
    values.push(status);
  }

  if (rawQuery) {
    const like = `%${rawQuery}%`;
    where.push(`(
      CAST(r.id AS CHAR) = ? OR
      r.user_id = ? OR
      COALESCE(r.part_id, '') LIKE ? OR
      COALESCE(r.video_id, '') LIKE ? OR
      LOWER(COALESCE(u.email, '')) LIKE LOWER(?) OR
      LOWER(COALESCE(u.username, '')) LIKE LOWER(?) OR
      LOWER(COALESCE(u.name, '')) LIKE LOWER(?) OR
      COALESCE(u.phone, '') LIKE ? OR
      LOWER(COALESCE(v.name, '')) LIKE LOWER(?) OR
      LOWER(COALESCE(e.title, '')) LIKE LOWER(?) OR
      LOWER(COALESCE(r.message, '')) LIKE LOWER(?)
    )`);
    values.push(
      rawQuery,
      rawQuery,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
    );
  }

  type Row = RowDataPacket & {
    id: number;
    user_id: UserId;
    user_name: string | null;
    user_username: string | null;
    user_email: string | null;
    user_phone: string | null;
    part_id: string | null;
    video_id: string | null;
    video_name: string | null;
    episode_id: string | null;
    episode_title: string | null;
    season_id: string | null;
    section_index: number | null;
    step: number | null;
    category: LearningBugReportCategory;
    status: LearningBugReportStatus;
    message: string | null;
    page_url: string | null;
    user_agent: string | null;
    created_at: Date;
  };

  const [rows] = await pool.execute<Row[]>(
    `
      SELECT
        r.id,
        r.user_id,
        u.name AS user_name,
        u.username AS user_username,
        u.email AS user_email,
        u.phone AS user_phone,
        r.part_id,
        r.video_id,
        v.name AS video_name,
        r.episode_id,
        e.title AS episode_title,
        r.season_id,
        r.section_index,
        r.step,
        r.category,
        ${hasStatusColumn ? "r.status" : "'new' AS status"},
        r.message,
        r.page_url,
        r.user_agent,
        r.created_at
      FROM learning_bug_reports r
      INNER JOIN users u ON u.id = r.user_id
      LEFT JOIN videos v ON v.id = r.video_id
      LEFT JOIN episodes e ON e.id = r.episode_id
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${limit}
    `,
    values,
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userUsername: row.user_username,
    userEmail: row.user_email,
    userPhone: row.user_phone,
    partId: row.part_id,
    videoId: row.video_id,
    videoName: row.video_name,
    episodeId: row.episode_id,
    episodeTitle: row.episode_title,
    seasonId: row.season_id,
    sectionIndex: row.section_index,
    step: row.step,
    category: row.category,
    status: row.status,
    message: row.message,
    pageUrl: row.page_url,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  }));
}

export async function updateLearningBugReportStatus(params: {
  reportId: number;
  status: LearningBugReportStatus;
}): Promise<boolean> {
  if (!(await hasLearningBugReportStatusColumn())) {
    throw new Error(
      "The learning_bug_reports.status column is missing. Run migration 20260709_learning_bug_reports_status.sql first.",
    );
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE learning_bug_reports SET status = ? WHERE id = ?`,
    [params.status, params.reportId],
  );
  return result.affectedRows > 0;
}
