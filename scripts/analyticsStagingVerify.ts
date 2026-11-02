/**
 * Staging DB verification for analytics correctness (no production access).
 *
 * Isolation:
 * - Stable fixture visitor/user/session UUIDs (safe to delete by id).
 * - Every fixture event tagged `properties.is_test = true`.
 * - Visitors stamped with utm_campaign `__staging_verify__`.
 * - Cleanup deletes fixture visitors (CASCADE) + fixture user at end.
 *
 * Admin product queries exclude `is_test` events by default
 * (`sqlNotTestEvent` in productQueries / adminQueries).
 *
 * Run: npx tsx scripts/analyticsStagingVerify.ts
 * Reset only: npx tsx scripts/analyticsStagingVerify.ts --cleanup-only
 */
import { loadLenraEnv } from "../src/loadEnv";

loadLenraEnv();

/** Stable fixture IDs — never reuse for real traffic. */
export const FIXTURE = {
  userId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
  visitorId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000002",
  sessionId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000003",
  organicVisitor: "aaaaaaaa-bbbb-4ccc-8ddd-000000000004",
  organicSession: "aaaaaaaa-bbbb-4ccc-8ddd-000000000005",
} as const;

const TEST_PROPS = JSON.stringify({ is_test: true, source: "analyticsStagingVerify" });
const UTM_CAMPAIGN = "__staging_verify__";

async function cleanupFixtures(
  pool: Awaited<ReturnType<typeof import("../src/lib/db/connection").getDbPool>>,
) {
  // CASCADE removes sessions, events, attribution for these visitors.
  await pool.execute(
    `DELETE FROM analytics_visitors WHERE id IN (?, ?)
       OR first_utm_campaign = ?`,
    [FIXTURE.visitorId, FIXTURE.organicVisitor, UTM_CAMPAIGN],
  );
  await pool.execute(`DELETE FROM users WHERE id = ?`, [FIXTURE.userId]);
}

async function main() {
  const { getDbPool, closeDbPool } = await import("../src/lib/db/connection");
  const { emitServerAnalyticsEvent } = await import(
    "../src/lib/analytics/serverEmit"
  );
  const {
    getActivationFunnel,
    getOrganicAcquisitionFunnel,
    getProductAnalyticsOverview,
    getRetentionCohorts,
  } = await import("../src/lib/analytics/productQueries");
  const { resolveAnalyticsRange } = await import(
    "../src/lib/analytics/adminQueries"
  );
  const { randomUUID } = await import("node:crypto");

  function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
  }

  const pool = getDbPool();
  const cleanupOnly = process.argv.includes("--cleanup-only");

  await cleanupFixtures(pool);
  if (cleanupOnly) {
    console.log(JSON.stringify({ ok: true, cleanupOnly: true, fixture: FIXTURE }));
    await closeDbPool().catch(() => undefined);
    return;
  }

  const { userId, visitorId, sessionId, organicVisitor, organicSession } =
    FIXTURE;

  await pool.execute(
    `INSERT INTO users (id, created_at) VALUES (?, UTC_TIMESTAMP(3))`,
    [userId],
  );

  await pool.execute(
    `INSERT INTO analytics_visitors
      (id, user_id, first_channel, last_channel, first_utm_campaign,
       first_seen_at, last_seen_at)
     VALUES (?, NULL, 'organic_search', 'organic_search', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [organicVisitor, UTM_CAMPAIGN],
  );
  await pool.execute(
    `INSERT INTO analytics_attribution
      (visitor_id, touch, channel, landing_path, utm_campaign)
     VALUES (?, 'first', 'organic_search', '/', ?)`,
    [organicVisitor, UTM_CAMPAIGN],
  );
  await pool.execute(
    `INSERT INTO analytics_sessions (id, visitor_id, started_at, last_activity_at)
     VALUES (?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [organicSession, organicVisitor],
  );
  await pool.execute(
    `INSERT INTO analytics_events
      (event_id, visitor_id, session_id, user_id, event_name, event_category, properties, created_at)
     VALUES (?, ?, ?, NULL, 'landing_page_view', 'website', CAST(? AS JSON), UTC_TIMESTAMP(3))`,
    [randomUUID(), organicVisitor, organicSession, TEST_PROPS],
  );

  await pool.execute(
    `INSERT INTO analytics_visitors
      (id, user_id, first_channel, last_channel, first_utm_campaign,
       first_seen_at, last_seen_at)
     VALUES (?, ?, 'utm', 'utm', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [visitorId, userId, UTM_CAMPAIGN],
  );
  await pool.execute(
    `INSERT INTO analytics_sessions (id, visitor_id, user_id, started_at, last_activity_at)
     VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [sessionId, visitorId, userId],
  );

  // Complete funnel chain for fixture (tagged is_test — excluded from Admin by default)
  for (const name of [
    "signup_started",
    "registration_completed",
    "signup_completed",
  ] as const) {
    await pool.execute(
      `INSERT INTO analytics_events
        (event_id, visitor_id, session_id, user_id, event_name, event_category, properties, created_at)
       VALUES (?, ?, ?, ?, ?, 'website', CAST(? AS JSON), UTC_TIMESTAMP(3))`,
      [randomUUID(), visitorId, sessionId, userId, name, TEST_PROPS],
    );
  }

  await emitServerAnalyticsEvent({
    userId,
    name: "lesson_complete",
    properties: {
      part_id: "part-1",
      is_test: true,
      source: "analyticsStagingVerify",
    },
    idempotencyKey: `fixture_lesson_${userId}`,
    context: { visitorId, sessionId },
  });
  await emitServerAnalyticsEvent({
    userId,
    name: "lesson_complete",
    properties: {
      part_id: "part-1",
      is_test: true,
      source: "analyticsStagingVerify",
    },
    idempotencyKey: `fixture_lesson_${userId}`,
    context: { visitorId, sessionId },
  });

  const [sessionCount] = await pool.query(
    `SELECT COUNT(*) AS c FROM analytics_sessions WHERE visitor_id = ?`,
    [visitorId],
  );
  const sessions = Number((sessionCount as { c: number }[])[0]?.c ?? 0);
  assert(
    sessions === 1,
    `expected 1 session after server emits, got ${sessions}`,
  );

  const [eventRows] = await pool.query(
    `SELECT event_name, session_id IS NULL AS null_session,
            JSON_EXTRACT(properties, '$.is_test') AS is_test
     FROM analytics_events WHERE user_id = ? AND event_name = 'lesson_complete'`,
    [userId],
  );
  const lessons = eventRows as {
    event_name: string;
    null_session: number;
    is_test: unknown;
  }[];
  assert(
    lessons.length === 1,
    `idempotent lesson_complete expected 1, got ${lessons.length}`,
  );
  assert(
    lessons[0]!.null_session === 0,
    "lesson_complete should attach real session",
  );

  await emitServerAnalyticsEvent({
    userId,
    name: "purchase",
    properties: {
      plan: "pro",
      provider: "bitpay",
      is_test: true,
      source: "analyticsStagingVerify",
    },
    idempotencyKey: `fixture_purchase_${userId}`,
  });
  const [purchase] = await pool.query(
    `SELECT session_id IS NULL AS null_session FROM analytics_events
     WHERE user_id = ? AND event_name = 'purchase'`,
    [userId],
  );
  assert(
    Number((purchase as { null_session: number }[])[0]?.null_session) === 1,
    "purchase without browser context must have NULL session_id",
  );

  const range = resolveAnalyticsRange("7d", null, null);
  const overview = await getProductAnalyticsOverview(range);
  assert(
    overview.learningTimeStatus === "unavailable",
    "learning time must be unavailable",
  );

  // Fixture registrations must NOT inflate Admin overview (is_test excluded).
  const [liveReg] = await pool.query(
    `SELECT COUNT(DISTINCT COALESCE(user_id, visitor_id)) AS c
     FROM analytics_events
     WHERE event_name IN ('registration_completed','signup_completed')
       AND IFNULL(JSON_EXTRACT(properties, '$.is_test'), false) = false
       AND created_at BETWEEN ? AND ?`,
    [range.from, range.to],
  );
  assert(
    Number((liveReg as { c: number }[])[0]?.c) === overview.registrations,
    "overview.registrations must match non-test registration count",
  );

  const funnel = await getActivationFunnel(range);
  const regStep = funnel.steps.find((s) => s.key === "registration");
  assert(regStep, "registration funnel step missing");

  const organic = await getOrganicAcquisitionFunnel(range);
  const retention = await getRetentionCohorts({ weeks: 4 });
  assert(Array.isArray(retention.cohorts), "cohorts array");
  assert(
    retention.definitions?.exact && retention.definitions?.rolling,
    "exact+rolling defs",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixture: FIXTURE,
        overview: {
          dau: overview.dau,
          registrations: overview.registrations,
          learningTimeStatus: overview.learningTimeStatus,
          reportingTimezone: overview.reportingTimezone,
        },
        funnelRegistrationExcludingTest: regStep!.count,
        organicVisitorsExcludingTestNoise: organic.organicVisitors,
        sessionsForUserVisitor: sessions,
        lessonCompleteRows: lessons.length,
        note: "Fixtures remain tagged is_test until --cleanup-only or next run cleanup.",
      },
      null,
      2,
    ),
  );

  // Leave tagged fixtures for optional Admin UI inspection, then clean.
  await cleanupFixtures(pool);
  console.log(JSON.stringify({ cleaned: true, fixture: FIXTURE }));

  await closeDbPool().catch(() => undefined);
}

main().catch((err) => {
  console.error("ANALYTICS_STAGING_VERIFY_FAILED", err);
  process.exitCode = 1;
});
