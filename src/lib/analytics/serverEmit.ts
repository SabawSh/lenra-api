import { randomUUID } from "node:crypto";
import { getDbPool } from "@/lib/db/connection";
import {
  ANALYTICS_MAX_PROPERTY_BYTES,
  ANALYTICS_NAME_SET,
  EVENT_CATEGORY_BY_NAME,
  type AnalyticsEventName,
} from "@/lib/analytics/eventCatalog";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export type ServerAnalyticsContext = {
  /** Anonymous visitor cookie — validated against DB ownership. */
  visitorId?: string | null;
  /** Browser analytics session — validated; never fabricated. */
  sessionId?: string | null;
};

/**
 * Server-authoritative analytics emit.
 * Never throws into the caller — analytics must not break learning/payments.
 *
 * Session rules:
 * - Prefer an existing visitor linked to the user, or a validated anonymous visitorId.
 * - Attach to a validated session when ownership matches; otherwise session_id is NULL.
 * - Never create a synthetic browser session (BitPay / background jobs stay sessionless).
 */
export async function emitServerAnalyticsEvent(input: {
  userId: string;
  name: AnalyticsEventName | string;
  path?: string;
  properties?: Record<string, string | number | boolean | null | undefined>;
  idempotencyKey?: string;
  context?: ServerAnalyticsContext;
}): Promise<void> {
  try {
    if (!input.userId || typeof input.userId !== "string") return;
    if (!ANALYTICS_NAME_SET.has(input.name)) return;
    const name = input.name as AnalyticsEventName;
    const category = EVENT_CATEGORY_BY_NAME[name];
    const pool = getDbPool();

    const cleaned: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(input.properties ?? {})) {
      if (k.length > 64) continue;
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        v === null
      ) {
        cleaned[k] = typeof v === "string" ? v.slice(0, 500) : v;
      }
    }
    const propsJson = Object.keys(cleaned).length
      ? JSON.stringify(cleaned)
      : null;
    if (propsJson && propsJson.length > ANALYTICS_MAX_PROPERTY_BYTES) return;

    const eventId = input.idempotencyKey?.slice(0, 36) || randomUUID();

    const visitorId = await resolveVisitorId(pool, input.userId, input.context);
    if (!visitorId) return;

    const sessionId = await resolveSessionId(
      pool,
      visitorId,
      input.userId,
      input.context?.sessionId,
    );

    await pool.execute<ResultSetHeader>(
      `INSERT IGNORE INTO analytics_events (
         event_id, visitor_id, session_id, user_id, event_name, event_category, path, properties
       ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
      [
        eventId,
        visitorId,
        sessionId,
        input.userId,
        name,
        category,
        input.path?.slice(0, 512) ?? null,
        propsJson,
      ],
    );

    await pool.execute(
      `UPDATE analytics_visitors SET last_seen_at = UTC_TIMESTAMP(3), user_id = COALESCE(user_id, ?) WHERE id = ?`,
      [input.userId, visitorId],
    );

    if (sessionId) {
      await pool.execute(
        `UPDATE analytics_sessions
         SET event_count = event_count + 1,
             user_id = COALESCE(user_id, ?),
             last_activity_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND visitor_id = ?`,
        [input.userId, sessionId, visitorId],
      );
    }
  } catch (err) {
    console.warn("[analytics/serverEmit]", err);
  }
}

async function resolveVisitorId(
  pool: ReturnType<typeof getDbPool>,
  userId: string,
  context?: ServerAnalyticsContext,
): Promise<string | null> {
  const hinted = context?.visitorId;
  if (isUuid(hinted)) {
    const [rows] = await pool.query<(RowDataPacket & { id: string; user_id: string | null })[]>(
      `SELECT id, user_id FROM analytics_visitors WHERE id = ? LIMIT 1`,
      [hinted],
    );
    const row = rows[0];
    if (row && (row.user_id == null || row.user_id === userId)) {
      if (row.user_id == null) {
        await pool.execute(
          `UPDATE analytics_visitors SET user_id = ? WHERE id = ? AND user_id IS NULL`,
          [userId, hinted],
        );
      }
      return hinted;
    }
  }

  const [visitors] = await pool.query<(RowDataPacket & { id: string })[]>(
    `SELECT id FROM analytics_visitors WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 1`,
    [userId],
  );
  if (visitors[0]?.id) return visitors[0].id;

  // Background / payment path: linked visitor without inventing a browser session.
  const visitorId = randomUUID();
  await pool.execute(
    `INSERT INTO analytics_visitors (id, user_id, first_channel, last_channel, first_seen_at, last_seen_at)
     VALUES (?, ?, 'direct', 'direct', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [visitorId, userId],
  );
  return visitorId;
}

async function resolveSessionId(
  pool: ReturnType<typeof getDbPool>,
  visitorId: string,
  userId: string,
  hinted: string | null | undefined,
): Promise<string | null> {
  if (!isUuid(hinted)) return null;
  const [rows] = await pool.query<
    (RowDataPacket & { id: string; visitor_id: string; user_id: string | null })[]
  >(
    `SELECT id, visitor_id, user_id FROM analytics_sessions WHERE id = ? LIMIT 1`,
    [hinted],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.visitor_id !== visitorId) return null;
  if (row.user_id != null && row.user_id !== userId) return null;
  return hinted;
}

/** Read analytics identity cookies from an incoming request (never trust body user ids). */
export function analyticsContextFromRequest(req: Request): ServerAnalyticsContext {
  const cookie = req.headers.get("cookie") ?? "";
  const visitorId = readCookie(cookie, "lenra_vid");
  const sessionId = readCookie(cookie, "lenra_sid");
  return {
    visitorId: isUuid(visitorId) ? visitorId : null,
    sessionId: isUuid(sessionId) ? sessionId : null,
  };
}

function readCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
