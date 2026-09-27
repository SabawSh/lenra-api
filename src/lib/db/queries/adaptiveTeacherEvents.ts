import { pool } from "@/lib/db/connection";
import type {
  AdaptiveTeacherDecision,
  AdaptiveTeacherDecisionType,
  AdaptiveTeacherMetrics,
} from "@/lib/skill/adaptiveTeacherDecision";
import type { UserId } from "@/types/schema";
import type { RowDataPacket } from "mysql2/promise";

export type AdaptiveTeacherEventRow = {
  id: number;
  userId: UserId;
  scopeId: string;
  createdAt: Date;
  previousLevel: string;
  newLevel: string;
  decision: AdaptiveTeacherDecisionType;
  confidence: number;
  reason: string;
  metrics: AdaptiveTeacherMetrics;
  modelVersion: string;
  notes: string | null;
};

type EventDbRow = RowDataPacket & {
  id: number;
  user_id: string;
  scope_id: string;
  created_at: Date;
  previous_level: string;
  new_level: string;
  decision: AdaptiveTeacherDecisionType;
  confidence: number;
  reason: string;
  metrics: string | AdaptiveTeacherMetrics;
  model_version: string;
  notes: string | null;
};

function mapEventRow(row: EventDbRow): AdaptiveTeacherEventRow {
  const metrics =
    typeof row.metrics === "string"
      ? (JSON.parse(row.metrics) as AdaptiveTeacherMetrics)
      : row.metrics;

  return {
    id: row.id,
    userId: row.user_id as UserId,
    scopeId: row.scope_id,
    createdAt: row.created_at,
    previousLevel: row.previous_level,
    newLevel: row.new_level,
    decision: row.decision,
    confidence: Number(row.confidence),
    reason: row.reason,
    metrics,
    modelVersion: row.model_version,
    notes: row.notes,
  };
}

export async function insertAdaptiveTeacherEvent(params: {
  userId: UserId;
  scopeId: string;
  decision: AdaptiveTeacherDecision;
  notes?: string | null;
}): Promise<void> {
  await pool.execute(
    `
    INSERT INTO adaptive_teacher_events (
      user_id,
      scope_id,
      previous_level,
      new_level,
      decision,
      confidence,
      reason,
      metrics,
      model_version,
      notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      params.userId,
      params.scopeId,
      params.decision.previousLevel,
      params.decision.newLevel,
      params.decision.decision,
      params.decision.confidence,
      params.decision.explanation,
      JSON.stringify(params.decision.metrics),
      params.decision.modelVersion,
      params.notes ?? null,
    ],
  );
}

export async function listAdaptiveTeacherEventsForUser(
  userId: UserId,
  limit = 200,
): Promise<AdaptiveTeacherEventRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const [rows] = await pool.execute<EventDbRow[]>(
    `
    SELECT
      id,
      user_id,
      scope_id,
      created_at,
      previous_level,
      new_level,
      decision,
      confidence,
      reason,
      metrics,
      model_version,
      notes
    FROM adaptive_teacher_events
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ${safeLimit}
    `,
    [userId],
  );

  return rows.map(mapEventRow);
}

export async function countAdaptiveTeacherEventsForUser(
  userId: UserId,
): Promise<number> {
  type R = RowDataPacket & { count: number };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS count
    FROM adaptive_teacher_events
    WHERE user_id = ?
    `,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}
