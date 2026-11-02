import { getDbPool } from "@/lib/db/connection";
import {
  ANALYTICS_MAX_BATCH,
  ANALYTICS_MAX_PROPERTY_BYTES,
  ANALYTICS_NAME_SET,
  EVENT_CATEGORY_BY_NAME,
  type AnalyticsEventName,
} from "@/lib/analytics/eventCatalog";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

export type CollectContext = {
  path?: string;
  referrer?: string;
  landingPath?: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
  };
  deviceCategory?: string;
  browser?: string;
  os?: string;
  language?: string;
  channel?: string;
  referrerDomain?: string;
};

export type CollectEvent = {
  eventId: string;
  name: string;
  path?: string;
  properties?: Record<string, unknown>;
  clientTs?: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function sanitizeProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!properties || typeof properties !== "object") return null;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key.length > 64) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      cleaned[key] = typeof value === "string" ? value.slice(0, 500) : value;
    }
  }
  const json = JSON.stringify(cleaned);
  if (json.length > ANALYTICS_MAX_PROPERTY_BYTES) return null;
  return cleaned;
}

function parseClientTs(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const now = Date.now();
  if (d.getTime() > now + 5 * 60_000) return null;
  if (d.getTime() < now - 7 * 24 * 60 * 60_000) return null;
  return d;
}

export async function ingestAnalyticsBatch(input: {
  visitorId: string;
  sessionId: string;
  userId: string | null;
  context?: CollectContext;
  events: CollectEvent[];
}): Promise<{ accepted: number; duplicates: number }> {
  if (!isUuid(input.visitorId) || !isUuid(input.sessionId)) {
    throw new Error("invalid_ids");
  }
  const events = input.events.slice(0, ANALYTICS_MAX_BATCH);
  if (events.length === 0) return { accepted: 0, duplicates: 0 };

  const pool = getDbPool();
  const conn = await pool.getConnection();
  let accepted = 0;
  let duplicates = 0;

  try {
    await conn.beginTransaction();

    const ctx = input.context ?? {};
    const channel = ctx.channel?.slice(0, 64) ?? null;
    const landing = (ctx.landingPath ?? ctx.path ?? "/").slice(0, 512);
    const referrerUrl = ctx.referrer?.slice(0, 1024) ?? null;
    const referrerDomain = ctx.referrerDomain?.slice(0, 255) ?? null;

    await conn.execute(
      `INSERT INTO analytics_visitors (
        id, user_id, first_landing_path, first_referrer_url, first_referrer_domain,
        first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content, first_utm_term,
        first_channel, last_landing_path, last_referrer_url, last_channel,
        device_category, browser, os, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE
        user_id = COALESCE(VALUES(user_id), user_id),
        last_seen_at = CURRENT_TIMESTAMP(3),
        last_landing_path = VALUES(last_landing_path),
        last_referrer_url = COALESCE(VALUES(last_referrer_url), last_referrer_url),
        last_channel = COALESCE(VALUES(last_channel), last_channel),
        device_category = COALESCE(VALUES(device_category), device_category),
        browser = COALESCE(VALUES(browser), browser),
        os = COALESCE(VALUES(os), os),
        is_returning = 1`,
      [
        input.visitorId,
        input.userId,
        landing,
        referrerUrl,
        referrerDomain,
        ctx.utm?.source?.slice(0, 191) ?? null,
        ctx.utm?.medium?.slice(0, 191) ?? null,
        ctx.utm?.campaign?.slice(0, 191) ?? null,
        ctx.utm?.content?.slice(0, 191) ?? null,
        ctx.utm?.term?.slice(0, 191) ?? null,
        channel,
        landing,
        referrerUrl,
        channel,
        ctx.deviceCategory?.slice(0, 32) ?? null,
        ctx.browser?.slice(0, 64) ?? null,
        ctx.os?.slice(0, 64) ?? null,
      ],
    );

    // First-touch attribution: insert once, never overwrite.
    await conn.execute(
      `INSERT IGNORE INTO analytics_attribution (
        visitor_id, touch, channel, referrer_url, referrer_domain, landing_path,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term
      ) VALUES (?, 'first', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.visitorId,
        channel,
        referrerUrl,
        referrerDomain,
        landing,
        ctx.utm?.source?.slice(0, 191) ?? null,
        ctx.utm?.medium?.slice(0, 191) ?? null,
        ctx.utm?.campaign?.slice(0, 191) ?? null,
        ctx.utm?.content?.slice(0, 191) ?? null,
        ctx.utm?.term?.slice(0, 191) ?? null,
      ],
    );

    // Last-touch: upsert every time.
    await conn.execute(
      `INSERT INTO analytics_attribution (
        visitor_id, touch, channel, referrer_url, referrer_domain, landing_path,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term, captured_at
      ) VALUES (?, 'last', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE
        channel = VALUES(channel),
        referrer_url = VALUES(referrer_url),
        referrer_domain = VALUES(referrer_domain),
        landing_path = VALUES(landing_path),
        utm_source = VALUES(utm_source),
        utm_medium = VALUES(utm_medium),
        utm_campaign = VALUES(utm_campaign),
        utm_content = VALUES(utm_content),
        utm_term = VALUES(utm_term),
        captured_at = CURRENT_TIMESTAMP(3)`,
      [
        input.visitorId,
        channel,
        referrerUrl,
        referrerDomain,
        landing,
        ctx.utm?.source?.slice(0, 191) ?? null,
        ctx.utm?.medium?.slice(0, 191) ?? null,
        ctx.utm?.campaign?.slice(0, 191) ?? null,
        ctx.utm?.content?.slice(0, 191) ?? null,
        ctx.utm?.term?.slice(0, 191) ?? null,
      ],
    );

    await conn.execute(
      `INSERT INTO analytics_sessions (
        id, visitor_id, user_id, entry_path, exit_path, landing_channel,
        device_category, browser, os, last_activity_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE
        user_id = COALESCE(VALUES(user_id), user_id),
        exit_path = VALUES(exit_path),
        last_activity_at = CURRENT_TIMESTAMP(3),
        device_category = COALESCE(VALUES(device_category), device_category),
        browser = COALESCE(VALUES(browser), browser),
        os = COALESCE(VALUES(os), os)`,
      [
        input.sessionId,
        input.visitorId,
        input.userId,
        landing,
        landing,
        channel,
        ctx.deviceCategory?.slice(0, 32) ?? null,
        ctx.browser?.slice(0, 64) ?? null,
        ctx.os?.slice(0, 64) ?? null,
      ],
    );

    for (const event of events) {
      if (!isUuid(event.eventId)) continue;
      if (!ANALYTICS_NAME_SET.has(event.name)) continue;
      const name = event.name as AnalyticsEventName;
      const category = EVENT_CATEGORY_BY_NAME[name];
      const props = sanitizeProperties(event.properties);
      const clientTs = parseClientTs(event.clientTs);
      const path = (event.path ?? ctx.path ?? landing)?.slice(0, 512) ?? null;

      try {
        const [result] = await conn.execute<ResultSetHeader>(
          `INSERT INTO analytics_events (
            event_id, visitor_id, session_id, user_id, event_name, event_category,
            path, properties, client_ts
          ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
          [
            event.eventId,
            input.visitorId,
            input.sessionId,
            input.userId,
            name,
            category,
            path,
            props ? JSON.stringify(props) : null,
            clientTs,
          ],
        );
        if (result.affectedRows > 0) {
          accepted += 1;
          if (name === "page_view") {
            await conn.execute(
              `UPDATE analytics_sessions
               SET page_count = page_count + 1,
                   event_count = event_count + 1,
                   exit_path = ?,
                   last_activity_at = CURRENT_TIMESTAMP(3),
                   is_bounce = CASE WHEN page_count + 1 <= 1 THEN 1 ELSE 0 END,
                   duration_ms = GREATEST(0, TIMESTAMPDIFF(MICROSECOND, started_at, CURRENT_TIMESTAMP(3)) DIV 1000)
               WHERE id = ?`,
              [path, input.sessionId],
            );
          } else {
            await conn.execute(
              `UPDATE analytics_sessions
               SET event_count = event_count + 1,
                   last_activity_at = CURRENT_TIMESTAMP(3),
                   duration_ms = GREATEST(0, TIMESTAMPDIFF(MICROSECOND, started_at, CURRENT_TIMESTAMP(3)) DIV 1000)
               WHERE id = ?`,
              [input.sessionId],
            );
          }
        }
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "ER_DUP_ENTRY") {
          duplicates += 1;
          continue;
        }
        throw err;
      }
    }

    await conn.commit();
    return { accepted, duplicates };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function identifyVisitorToUser(input: {
  visitorId: string;
  sessionId?: string;
  userId: string;
}): Promise<void> {
  if (!isUuid(input.visitorId)) throw new Error("invalid_ids");
  const pool = getDbPool();

  // Ensure visitor row exists even if identify races ahead of first collect.
  await pool.execute(
    `INSERT INTO analytics_visitors (id, user_id, last_seen_at)
     VALUES (?, ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       user_id = COALESCE(user_id, VALUES(user_id)),
       last_seen_at = CURRENT_TIMESTAMP(3)`,
    [input.visitorId, input.userId],
  );

  await pool.execute(
    `UPDATE analytics_visitors
     SET user_id = ?, last_seen_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND (user_id IS NULL OR user_id = ?)`,
    [input.userId, input.visitorId, input.userId],
  );

  if (input.sessionId && isUuid(input.sessionId)) {
    await pool.execute(
      `UPDATE analytics_sessions
       SET user_id = ?
       WHERE id = ? AND visitor_id = ? AND (user_id IS NULL OR user_id = ?)`,
      [input.userId, input.sessionId, input.visitorId, input.userId],
    );
  }

  await pool.execute(
    `UPDATE analytics_events
     SET user_id = ?
     WHERE visitor_id = ? AND user_id IS NULL`,
    [input.userId, input.visitorId],
  );
}

export async function visitorExists(visitorId: string): Promise<boolean> {
  if (!isUuid(visitorId)) return false;
  const pool = getDbPool();
  const [rows] = await pool.query<(RowDataPacket & { id: string })[]>(
    `SELECT id FROM analytics_visitors WHERE id = ? LIMIT 1`,
    [visitorId],
  );
  return rows.length > 0;
}
