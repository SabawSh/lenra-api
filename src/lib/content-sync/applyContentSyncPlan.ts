import { randomUUID } from "crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { mapCanonicalKeyFromDb } from "@/lib/db/partsCanonicalKey";
import {
  pipelineClipToOwnedPayload,
  stableTokensJson,
} from "./contentFieldOwnership";
import { getContentSyncPool } from "./syncDb";
import type {
  ContentSyncPlan,
  ExistingSyncPart,
  PipelineClip,
} from "./types";

/** Temporary order base to free UNIQUE(episode_id, order) during apply. */
export const CONTENT_SYNC_TEMP_ORDER_BASE = 10_000_000;

function parseDifficulty(
  value: unknown,
): "easy" | "medium" | "hard" {
  const raw = String(value ?? "easy").toLowerCase();
  if (raw === "medium" || raw === "hard") return raw;
  return "easy";
}

function tokensJsonFromRow(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}

export function mapRowToExistingSyncPart(
  row: Record<string, unknown>,
): ExistingSyncPart {
  return {
    id: String(row.id),
    episodeId: String(row.episode_id),
    order: Number(row.part_order ?? row.order ?? 0),
    canonicalKey: mapCanonicalKeyFromDb(row.canonical_key),
    text: String(row.text ?? ""),
    retiredAt: row.retired_at != null ? (row.retired_at as Date) : null,
    playbackStartMs: row.start_ms != null ? Number(row.start_ms) : null,
    playbackEndMs: row.end_ms != null ? Number(row.end_ms) : null,
    playbackDurationMs:
      row.duration_ms != null ? Number(row.duration_ms) : null,
    speechStartMs:
      row.speech_start_ms != null ? Number(row.speech_start_ms) : null,
    speechEndMs:
      row.speech_end_ms != null ? Number(row.speech_end_ms) : null,
    speechDurationMs:
      row.speech_duration_ms != null ? Number(row.speech_duration_ms) : null,
    difficulty: parseDifficulty(row.difficulty),
    difficultyScore:
      row.difficulty_score != null ? Number(row.difficulty_score) : null,
    wordCount: Number(row.word_count ?? 0),
    speechRate: row.speech_rate != null ? Number(row.speech_rate) : null,
    tokensJson: tokensJsonFromRow(row.tokens),
  };
}

export async function listPartsForContentSync(
  episodeId: string,
): Promise<ExistingSyncPart[]> {
  const pool = getContentSyncPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT *, \`order\` AS part_order
    FROM parts
    WHERE episode_id = ?
    ORDER BY \`order\` ASC
    `,
    [episodeId],
  );
  return rows.map((r) => mapRowToExistingSyncPart(r as Record<string, unknown>));
}

export async function assertEpisodeExists(episodeId: string): Promise<void> {
  const pool = getContentSyncPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM episodes WHERE id = ? LIMIT 1`,
    [episodeId],
  );
  if (rows.length === 0) {
    throw new Error(`Episode not found: ${episodeId}`);
  }
}

async function updatePartFromClip(
  conn: PoolConnection,
  partId: string,
  clip: PipelineClip,
  retiredAt: Date | null,
): Promise<void> {
  const owned = pipelineClipToOwnedPayload(clip);
  await conn.execute<ResultSetHeader>(
    `
    UPDATE parts SET
      canonical_key = ?,
      \`order\` = ?,
      text = ?,
      start_ms = ?,
      end_ms = ?,
      duration_ms = ?,
      speech_start_ms = ?,
      speech_end_ms = ?,
      speech_duration_ms = ?,
      tokens = ?,
      difficulty = ?,
      difficulty_score = ?,
      word_count = ?,
      speech_rate = ?,
      source_clip_start_ms = ?,
      source_clip_end_ms = ?,
      subtitles = ?,
      processing_status = 'ready',
      retired_at = ?
    WHERE id = ?
    `,
    [
      mapCanonicalKeyFromDb(owned.canonicalKey),
      owned.order,
      owned.text,
      owned.playbackStartMs,
      owned.playbackEndMs,
      owned.playbackDurationMs,
      owned.speechStartMs,
      owned.speechEndMs,
      owned.speechDurationMs,
      stableTokensJson(owned.tokens),
      owned.difficulty,
      owned.difficultyScore,
      owned.wordCount,
      owned.speechRate,
      owned.sourceClipStartMs,
      owned.sourceClipEndMs,
      owned.subtitles != null ? JSON.stringify(owned.subtitles) : null,
      retiredAt,
      partId,
    ],
  );
}

async function insertPartFromClip(
  conn: PoolConnection,
  episodeId: string,
  clip: PipelineClip,
): Promise<string> {
  const owned = pipelineClipToOwnedPayload(clip);
  const id = randomUUID();
  await conn.execute<ResultSetHeader>(
    `
    INSERT INTO parts (
      id, episode_id, \`order\`, canonical_key, text,
      start_ms, end_ms, duration_ms,
      speech_start_ms, speech_end_ms, speech_duration_ms,
      tokens, difficulty, difficulty_score, word_count, speech_rate,
      source_clip_start_ms, source_clip_end_ms, subtitles,
      video_url, processing_status, retired_at, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      NULL, 'ready', NULL, NOW(3)
    )
    `,
    [
      id,
      episodeId,
      owned.order,
      mapCanonicalKeyFromDb(owned.canonicalKey),
      owned.text,
      owned.playbackStartMs,
      owned.playbackEndMs,
      owned.playbackDurationMs,
      owned.speechStartMs,
      owned.speechEndMs,
      owned.speechDurationMs,
      stableTokensJson(owned.tokens),
      owned.difficulty,
      owned.difficultyScore,
      owned.wordCount,
      owned.speechRate,
      owned.sourceClipStartMs,
      owned.sourceClipEndMs,
      owned.subtitles != null ? JSON.stringify(owned.subtitles) : null,
    ],
  );
  return id;
}

/**
 * Apply a sync plan using an existing connection (caller owns the transaction).
 * Dry-run plans must not call this.
 */
export async function applyContentSyncPlanOnConnection(
  conn: PoolConnection,
  plan: ContentSyncPlan,
  clipsByOrder: Map<number, PipelineClip>,
): Promise<void> {
  if (plan.dryRun) {
    throw new Error("applyContentSyncPlan refused dry-run plan");
  }
  if (plan.ambiguousMatches.length > 0) {
    throw new Error(
      `Refusing to apply sync with ${plan.ambiguousMatches.length} ambiguous match(es)`,
    );
  }

  const [allRows] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM parts WHERE episode_id = ? ORDER BY \`order\` ASC, id ASC`,
    [plan.episodeId],
  );
  let temp = CONTENT_SYNC_TEMP_ORDER_BASE;
  for (const row of allRows) {
    await conn.execute<ResultSetHeader>(
      `UPDATE parts SET \`order\` = ? WHERE id = ?`,
      [temp++, String(row.id)],
    );
  }

  for (const match of plan.matches) {
    const clip = clipsByOrder.get(match.pipelineOrder);
    if (!clip) {
      throw new Error(`Missing pipeline clip for order ${match.pipelineOrder}`);
    }
    await updatePartFromClip(conn, match.partId, clip, null);
  }

  for (const insert of plan.inserts) {
    await insertPartFromClip(conn, plan.episodeId, insert.clip);
  }

  for (const retire of plan.retires) {
    await conn.execute<ResultSetHeader>(
      `UPDATE parts SET retired_at = NOW(3) WHERE id = ?`,
      [retire.partId],
    );
  }
}

/**
 * Apply a sync plan inside a transaction.
 * Dry-run plans must not call this.
 */
export async function applyContentSyncPlan(
  plan: ContentSyncPlan,
  clipsByOrder: Map<number, PipelineClip>,
): Promise<void> {
  const pool = getContentSyncPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await applyContentSyncPlanOnConnection(conn, plan, clipsByOrder);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
