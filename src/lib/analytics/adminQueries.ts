import { getDbPool } from "@/lib/db/connection";
import type { RowDataPacket } from "mysql2";
import { sqlNotTestEvent } from "@/lib/analytics/testDataFilter";

export type DateRange = { from: Date; to: Date };

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function resolveAnalyticsRange(
  preset: string | null,
  fromIso?: string | null,
  toIso?: string | null,
): DateRange {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  switch (preset) {
    case "yesterday": {
      start.setDate(start.getDate() - 1);
      end.setTime(start.getTime());
      end.setHours(23, 59, 59, 999);
      break;
    }
    case "7d":
      start.setDate(start.getDate() - 6);
      break;
    case "30d":
      start.setDate(start.getDate() - 29);
      break;
    case "90d":
      start.setDate(start.getDate() - 89);
      break;
    case "custom": {
      if (fromIso) {
        const f = new Date(fromIso);
        if (!Number.isNaN(f.getTime())) start.setTime(f.getTime());
      }
      if (toIso) {
        const t = new Date(toIso);
        if (!Number.isNaN(t.getTime())) {
          end.setTime(t.getTime());
          end.setHours(23, 59, 59, 999);
        }
      }
      break;
    }
    case "today":
    default:
      break;
  }
  return { from: start, to: end };
}

export async function getAnalyticsOverview(range: DateRange) {
  const pool = getDbPool();
  const from = range.from;
  const to = range.to;

  const [[kpi]] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT
      (SELECT COUNT(*) FROM analytics_visitors
        WHERE first_seen_at BETWEEN ? AND ?) AS new_visitors,
      (SELECT COUNT(DISTINCT visitor_id) FROM analytics_sessions
        WHERE started_at BETWEEN ? AND ?) AS unique_visitors,
      (SELECT COUNT(*) FROM analytics_sessions
        WHERE started_at BETWEEN ? AND ?) AS sessions,
      (SELECT COALESCE(AVG(duration_ms), 0) FROM analytics_sessions
        WHERE started_at BETWEEN ? AND ? AND duration_ms > 0) AS avg_duration_ms,
      (SELECT COALESCE(AVG(page_count), 0) FROM analytics_sessions
        WHERE started_at BETWEEN ? AND ?) AS pages_per_session,
      (SELECT COALESCE(AVG(is_bounce), 0) FROM analytics_sessions
        WHERE started_at BETWEEN ? AND ?) AS bounce_rate,
      (SELECT COUNT(*) FROM users
        WHERE created_at BETWEEN ? AND ?) AS new_users,
      (SELECT COUNT(DISTINCT user_id) FROM analytics_sessions
        WHERE started_at BETWEEN ? AND ? AND user_id IS NOT NULL) AS active_users,
      (SELECT COUNT(*) FROM analytics_events
        WHERE created_at BETWEEN ? AND ? AND event_name = 'signup_completed'
          AND ${sqlNotTestEvent()}) AS signups_tracked,
      (SELECT COUNT(DISTINCT visitor_id) FROM analytics_sessions
        WHERE started_at BETWEEN ? AND ?) AS session_visitors
    `,
    [
      from, to,
      from, to,
      from, to,
      from, to,
      from, to,
      from, to,
      from, to,
      from, to,
      from, to,
      from, to,
    ],
  );

  const sessions = asNumber(kpi?.sessions);
  const uniqueVisitors = asNumber(kpi?.unique_visitors);
  const signups = asNumber(kpi?.signups_tracked);
  const newUsers = asNumber(kpi?.new_users);
  const conversions = Math.max(signups, newUsers);

  return {
    totalVisitors: asNumber(kpi?.new_visitors),
    uniqueVisitors,
    newUsers,
    returningUsers: Math.max(0, uniqueVisitors - asNumber(kpi?.new_visitors)),
    registeredUsersActive: asNumber(kpi?.active_users),
    sessions,
    avgSessionDurationMs: Math.round(asNumber(kpi?.avg_duration_ms)),
    pagesPerSession: Number(asNumber(kpi?.pages_per_session).toFixed(2)),
    /** Bounce = sessions with ≤1 page_view / total sessions in range. */
    bounceRate: Number(asNumber(kpi?.bounce_rate).toFixed(4)),
    bounceRateDefinition:
      "Share of sessions in range with at most one page_view (page_count ≤ 1).",
    signupConversionRate:
      uniqueVisitors > 0
        ? Number((conversions / uniqueVisitors).toFixed(4))
        : 0,
    range: { from: from.toISOString(), to: to.toISOString() },
  };
}

export async function getAcquisitionAnalytics(range: DateRange) {
  const pool = getDbPool();
  const [channels] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT COALESCE(a.channel, 'other') AS channel, COUNT(*) AS visitors
     FROM analytics_attribution a
     JOIN analytics_visitors v ON v.id = a.visitor_id
     WHERE a.touch = 'first'
       AND v.first_seen_at BETWEEN ? AND ?
     GROUP BY COALESCE(a.channel, 'other')
     ORDER BY visitors DESC`,
    [range.from, range.to],
  );

  const [lastTouch] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT COALESCE(a.channel, 'other') AS channel, COUNT(*) AS visitors
     FROM analytics_attribution a
     JOIN analytics_visitors v ON v.id = a.visitor_id
     WHERE a.touch = 'last'
       AND v.last_seen_at BETWEEN ? AND ?
     GROUP BY COALESCE(a.channel, 'other')
     ORDER BY visitors DESC`,
    [range.from, range.to],
  );

  const [referrers] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT COALESCE(a.referrer_domain, '(none)') AS domain, COUNT(*) AS visitors
     FROM analytics_attribution a
     JOIN analytics_visitors v ON v.id = a.visitor_id
     WHERE a.touch = 'first'
       AND v.first_seen_at BETWEEN ? AND ?
     GROUP BY COALESCE(a.referrer_domain, '(none)')
     ORDER BY visitors DESC
     LIMIT 25`,
    [range.from, range.to],
  );

  const [landings] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT COALESCE(a.landing_path, '/') AS path, COUNT(*) AS visitors
     FROM analytics_attribution a
     JOIN analytics_visitors v ON v.id = a.visitor_id
     WHERE a.touch = 'first'
       AND v.first_seen_at BETWEEN ? AND ?
     GROUP BY COALESCE(a.landing_path, '/')
     ORDER BY visitors DESC
     LIMIT 25`,
    [range.from, range.to],
  );

  const [campaigns] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT
        COALESCE(a.utm_campaign, '(none)') AS campaign,
        COALESCE(a.utm_source, '(none)') AS source,
        COALESCE(a.utm_medium, '(none)') AS medium,
        COUNT(*) AS visitors
     FROM analytics_attribution a
     JOIN analytics_visitors v ON v.id = a.visitor_id
     WHERE a.touch = 'first'
       AND v.first_seen_at BETWEEN ? AND ?
     GROUP BY campaign, source, medium
     ORDER BY visitors DESC
     LIMIT 25`,
    [range.from, range.to],
  );

  const [conversions] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT COALESCE(a.channel, 'other') AS channel, COUNT(DISTINCT e.visitor_id) AS signups
     FROM analytics_events e
     LEFT JOIN analytics_attribution a
       ON a.visitor_id = e.visitor_id AND a.touch = 'first'
     WHERE e.event_name IN ('signup_completed', 'login')
       AND e.created_at BETWEEN ? AND ?
     GROUP BY COALESCE(a.channel, 'other')
     ORDER BY signups DESC`,
    [range.from, range.to],
  );

  return {
    firstTouchChannels: channels.map((r) => ({
      channel: String(r.channel),
      visitors: asNumber(r.visitors),
    })),
    lastTouchChannels: lastTouch.map((r) => ({
      channel: String(r.channel),
      visitors: asNumber(r.visitors),
    })),
    referringDomains: referrers.map((r) => ({
      domain: String(r.domain),
      visitors: asNumber(r.visitors),
    })),
    landingPages: landings.map((r) => ({
      path: String(r.path),
      visitors: asNumber(r.visitors),
    })),
    campaigns: campaigns.map((r) => ({
      campaign: String(r.campaign),
      source: String(r.source),
      medium: String(r.medium),
      visitors: asNumber(r.visitors),
    })),
    conversionsByChannel: conversions.map((r) => ({
      channel: String(r.channel),
      signups: asNumber(r.signups),
    })),
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
  };
}

export type UserExplorerFilters = {
  q?: string;
  channel?: string;
  registered?: "yes" | "no" | "any";
  device?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
};

export async function getAnalyticsUserExplorer(filters: UserExplorerFilters) {
  const pool = getDbPool();
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const where: string[] = ["1=1"];
  const params: unknown[] = [];

  if (filters.q?.trim()) {
    where.push(
      `(u.email LIKE ? OR u.name LIKE ? OR u.phone LIKE ? OR v.id LIKE ? OR u.id LIKE ?)`,
    );
    const like = `%${filters.q.trim()}%`;
    params.push(like, like, like, like, like);
  }
  if (filters.channel && filters.channel !== "any") {
    where.push(`COALESCE(fa.channel, v.first_channel, 'other') = ?`);
    params.push(filters.channel);
  }
  if (filters.registered === "yes") where.push(`v.user_id IS NOT NULL`);
  if (filters.registered === "no") where.push(`v.user_id IS NULL`);
  if (filters.device && filters.device !== "any") {
    where.push(`v.device_category = ?`);
    params.push(filters.device);
  }
  if (filters.from) {
    where.push(`v.last_seen_at >= ?`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`v.last_seen_at <= ?`);
    params.push(filters.to);
  }

  const sql = `
    SELECT
      v.id AS visitor_id,
      v.user_id,
      u.email,
      u.name,
      u.username,
      v.first_seen_at,
      v.last_seen_at,
      COALESCE(fa.channel, v.first_channel, 'other') AS first_channel,
      v.device_category,
      v.browser,
      v.os,
      (SELECT COUNT(*) FROM analytics_sessions s WHERE s.visitor_id = v.id) AS sessions,
      (SELECT COUNT(*) FROM analytics_events e WHERE e.visitor_id = v.id) AS events
    FROM analytics_visitors v
    LEFT JOIN users u ON u.id = v.user_id
    LEFT JOIN analytics_attribution fa ON fa.visitor_id = v.id AND fa.touch = 'first'
    WHERE ${where.join(" AND ")}
    ORDER BY v.last_seen_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const [rows] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    sql,
    params,
  );

  return {
    users: rows.map((r) => ({
      visitorId: String(r.visitor_id),
      userId: r.user_id ? String(r.user_id) : null,
      email: r.email ? String(r.email) : null,
      name: r.name ? String(r.name) : null,
      username: r.username ? String(r.username) : null,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      firstChannel: String(r.first_channel),
      deviceCategory: r.device_category ? String(r.device_category) : null,
      browser: r.browser ? String(r.browser) : null,
      os: r.os ? String(r.os) : null,
      sessions: asNumber(r.sessions),
      events: asNumber(r.events),
    })),
    limit,
    offset,
  };
}

export async function getAnalyticsUserProfile(visitorId: string) {
  const pool = getDbPool();
  const [visitors] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT v.*, u.email, u.name, u.username, u.created_at AS registered_at
     FROM analytics_visitors v
     LEFT JOIN users u ON u.id = v.user_id
     WHERE v.id = ?
     LIMIT 1`,
    [visitorId],
  );
  const visitor = visitors[0];
  if (!visitor) return null;

  const [firstTouch] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT * FROM analytics_attribution WHERE visitor_id = ? AND touch = 'first' LIMIT 1`,
    [visitorId],
  );
  const [lastTouch] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT * FROM analytics_attribution WHERE visitor_id = ? AND touch = 'last' LIMIT 1`,
    [visitorId],
  );

  const [[counts]] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT
      (SELECT COUNT(*) FROM analytics_sessions WHERE visitor_id = ?) AS sessions,
      (SELECT COUNT(*) FROM analytics_events WHERE visitor_id = ?) AS events,
      (SELECT COUNT(*) FROM analytics_events WHERE visitor_id = ? AND event_name = 'page_view') AS page_views,
      (SELECT COALESCE(SUM(duration_ms), 0) FROM analytics_sessions WHERE visitor_id = ?) AS session_duration_sum_ms
    `,
    [visitorId, visitorId, visitorId, visitorId],
  );

  const [timeline] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT event_id, event_name, event_category, path, properties, client_ts, created_at
     FROM analytics_events
     WHERE visitor_id = ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [visitorId],
  );

  return {
    visitor: {
      id: String(visitor.id),
      userId: visitor.user_id ? String(visitor.user_id) : null,
      email: visitor.email ? String(visitor.email) : null,
      name: visitor.name ? String(visitor.name) : null,
      username: visitor.username ? String(visitor.username) : null,
      registeredAt: visitor.registered_at ?? null,
      firstSeenAt: visitor.first_seen_at,
      lastSeenAt: visitor.last_seen_at,
      deviceCategory: visitor.device_category,
      browser: visitor.browser,
      os: visitor.os,
      country: visitor.country,
    },
    counts: {
      sessions: asNumber(counts?.sessions),
      events: asNumber(counts?.events),
      pageViews: asNumber(counts?.page_views),
      /** Browser session duration sum — not learning time. */
      totalSessionDurationMs: asNumber(counts?.session_duration_sum_ms),
    },
    firstTouch: firstTouch[0] ?? null,
    lastTouch: lastTouch[0] ?? null,
    timeline: timeline.map((e) => ({
      eventId: String(e.event_id),
      name: String(e.event_name),
      category: String(e.event_category),
      path: e.path ? String(e.path) : null,
      properties: e.properties,
      clientTs: e.client_ts,
      createdAt: e.created_at,
    })),
  };
}
