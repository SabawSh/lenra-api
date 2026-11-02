import { getDbPool } from "@/lib/db/connection";
import type { DateRange } from "@/lib/analytics/adminQueries";
import {
  getReportingTzOffsetMinutes,
  reportingTimezoneLabel,
  sqlLocalDateExpr,
} from "@/lib/analytics/reportingTime";
import { sqlNotTestEvent } from "@/lib/analytics/testDataFilter";
import type { RowDataPacket } from "mysql2";

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

/** Meaningful learning activity (excludes listening_completed until shipped). */
const LEARNING_EVENTS = [
  "lesson_complete",
  "first_lesson_completed",
  "exercise_completed",
  "speaking_completed",
  "sentence_rebuild_completed",
  "xp_earned",
  "review_session_completed",
  "learning_session_completed",
  "daily_goal_completed",
] as const;

const LEARNING_EVENTS_SQL = LEARNING_EVENTS.map((e) => `'${e}'`).join(",");

const METRICS_AVAILABLE_FROM = "2026-11-02";

const FIRST_CHANNEL_ORGANIC = `COALESCE(fa.channel, v.first_channel) = 'organic_search'`;

function localDateCol(columnSql: string): string {
  return sqlLocalDateExpr(columnSql);
}

export async function getProductAnalyticsOverview(range: DateRange) {
  const pool = getDbPool();
  const { from, to } = range;
  const tz = reportingTimezoneLabel();
  const offset = getReportingTzOffsetMinutes();
  const eventLocal = localDateCol("e.created_at");
  const notTestEvent = sqlNotTestEvent("e");
  const notTestBare = sqlNotTestEvent();
  const endLocal = `DATE(DATE_ADD(?, INTERVAL ${offset} MINUTE))`;

  const [[row]] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM users WHERE created_at BETWEEN ? AND ?) AS new_users,
      (SELECT COUNT(DISTINCT e.user_id) FROM analytics_events e
        WHERE e.user_id IS NOT NULL
          AND e.event_name IN (${LEARNING_EVENTS_SQL})
          AND ${eventLocal} = ${endLocal}
          AND ${notTestEvent}) AS dau,
      (SELECT COUNT(DISTINCT e.user_id) FROM analytics_events e
        WHERE e.user_id IS NOT NULL
          AND e.event_name IN (${LEARNING_EVENTS_SQL})
          AND ${eventLocal} BETWEEN DATE_SUB(${endLocal}, INTERVAL 6 DAY) AND ${endLocal}
          AND ${notTestEvent}) AS wau,
      (SELECT COUNT(DISTINCT e.user_id) FROM analytics_events e
        WHERE e.user_id IS NOT NULL
          AND e.event_name IN (${LEARNING_EVENTS_SQL})
          AND ${eventLocal} BETWEEN DATE_SUB(${endLocal}, INTERVAL 29 DAY) AND ${endLocal}
          AND ${notTestEvent}) AS mau,
      (SELECT COUNT(DISTINCT e.user_id) FROM analytics_events e
        WHERE e.user_id IS NOT NULL
          AND e.created_at BETWEEN ? AND ?
          AND e.event_name IN (${LEARNING_EVENTS_SQL})
          AND ${notTestEvent}) AS active_learners_in_range,
      (SELECT COUNT(*) FROM analytics_events
        WHERE created_at BETWEEN ? AND ? AND event_name = 'lesson_start'
          AND ${notTestBare}) AS lessons_started,
      (SELECT COUNT(*) FROM analytics_events
        WHERE created_at BETWEEN ? AND ? AND event_name = 'lesson_complete'
          AND ${notTestBare}) AS lessons_completed,
      (SELECT COALESCE(SUM(JSON_EXTRACT(properties, '$.xp')), 0) FROM analytics_events
        WHERE created_at BETWEEN ? AND ? AND event_name = 'xp_earned'
          AND ${notTestBare}) AS xp_awarded,
      (SELECT COUNT(DISTINCT COALESCE(user_id, visitor_id)) FROM analytics_events
        WHERE created_at BETWEEN ? AND ?
          AND event_name IN ('registration_completed','signup_completed')
          AND ${notTestBare}) AS registrations,
      (SELECT COUNT(DISTINCT visitor_id) FROM analytics_sessions
        WHERE started_at BETWEEN ? AND ?) AS unique_visitors
    `,
    [
      from, to,
      to, // dau endLocal
      to, to, // wau endLocal x2
      to, to, // mau endLocal x2
      from, to, // active learners
      from, to, // lessons started
      from, to, // lessons completed
      from, to, // xp
      from, to, // registrations
      from, to, // visitors
    ],
  );

  const visitors = asNumber(row?.unique_visitors);
  const registrations = asNumber(row?.registrations);

  // Prefer first_* events; fall back to earliest lesson_start/complete in range.
  const [[firstLesson]] = await pool.query<
    (RowDataPacket & Record<string, unknown>)[]
  >(
    `
    SELECT
      (SELECT COUNT(*) FROM (
        SELECT user_id FROM analytics_events
        WHERE user_id IS NOT NULL
          AND created_at BETWEEN ? AND ?
          AND event_name = 'first_lesson_started'
          AND ${notTestBare}
        GROUP BY user_id
        UNION
        SELECT user_id FROM (
          SELECT user_id, MIN(created_at) AS first_at
          FROM analytics_events
          WHERE user_id IS NOT NULL AND event_name = 'lesson_start'
          AND ${notTestBare}
          GROUP BY user_id
        ) earliest_start
        WHERE earliest_start.first_at BETWEEN ? AND ?
          AND earliest_start.user_id NOT IN (
            SELECT DISTINCT user_id FROM analytics_events
            WHERE user_id IS NOT NULL AND event_name = 'first_lesson_started'
          AND ${notTestBare}
          )
      ) starters) AS starters,
      (SELECT COUNT(*) FROM (
        SELECT user_id FROM analytics_events
        WHERE user_id IS NOT NULL
          AND created_at BETWEEN ? AND ?
          AND event_name = 'first_lesson_completed'
          AND ${notTestBare}
        GROUP BY user_id
        UNION
        SELECT user_id FROM (
          SELECT user_id, MIN(created_at) AS first_at
          FROM analytics_events
          WHERE user_id IS NOT NULL AND event_name = 'lesson_complete'
          AND ${notTestBare}
          GROUP BY user_id
        ) earliest_complete
        WHERE earliest_complete.first_at BETWEEN ? AND ?
          AND earliest_complete.user_id NOT IN (
            SELECT DISTINCT user_id FROM analytics_events
            WHERE user_id IS NOT NULL AND event_name = 'first_lesson_completed'
          AND ${notTestBare}
          )
      ) completers) AS completers
    `,
    [from, to, from, to, from, to, from, to],
  );

  const starters = asNumber(firstLesson?.starters);
  const completers = asNumber(firstLesson?.completers);

  return {
    totalUsers: asNumber(row?.total_users),
    newUsers: asNumber(row?.new_users),
    /** Distinct users with learning activity on the reporting end local date. */
    dau: asNumber(row?.dau),
    wau: asNumber(row?.wau),
    mau: asNumber(row?.mau),
    /** Distinct learners with meaningful activity anywhere in the selected range. */
    activeLearnersInRange: asNumber(row?.active_learners_in_range),
    lessonsStarted: asNumber(row?.lessons_started),
    lessonsCompleted: asNumber(row?.lessons_completed),
    xpAwarded: asNumber(row?.xp_awarded),
    registrations,
    registrationConversionRate: rate(registrations, visitors),
    firstLessonCompletionRate: rate(completers, starters),
    firstLessonStarters: starters,
    firstLessonCompleters: completers,
    /** Not inferred from browser session duration. */
    avgLearningTimeMs: null as number | null,
    learningTimeStatus: "unavailable" as const,
    reportingTimezone: tz,
    retentionDefinition:
      "Retained = user emitted a meaningful learning event (lesson/exercise/xp/review/daily goal complete), not a bare page_view.",
    metricsAvailableFrom: METRICS_AVAILABLE_FROM,
    range: { from: from.toISOString(), to: to.toISOString() },
  };
}

export async function getActivationFunnel(range: DateRange) {
  const pool = getDbPool();
  const { from, to } = range;
  const tz = reportingTimezoneLabel();
  const eventLocal = localDateCol("created_at");

  const definitions: Record<string, string> = {
    landing:
      "Distinct visitors with page_view or landing_page_view in range.",
    signup_started: "Distinct visitors with signup_started in range.",
    registration:
      "Distinct COALESCE(user_id, visitor_id) with registration_completed or signup_completed.",
    onboarding_completed: "Distinct user_id with onboarding_completed in range.",
    first_lesson_started:
      "Distinct user_id with first_lesson_started, or whose earliest lesson_start falls in range (historical fallback).",
    first_lesson_completed:
      "Distinct user_id with first_lesson_completed, or whose earliest lesson_complete falls in range (historical fallback).",
    return_learn:
      "Distinct users with meaningful learning activity on ≥2 distinct local reporting dates in range.",
    paid: "Distinct user_id with subscription_started or purchase in range.",
  };

  const notTest = sqlNotTestEvent();
  const steps: { key: string; label: string; sql: string }[] = [
    {
      key: "landing",
      label: "Landing / page view",
      sql: `SELECT COUNT(DISTINCT visitor_id) AS c FROM analytics_events
            WHERE created_at BETWEEN ? AND ?
              AND event_name IN ('page_view','landing_page_view')
              AND ${notTest}`,
    },
    {
      key: "signup_started",
      label: "Registration started",
      sql: `SELECT COUNT(DISTINCT visitor_id) AS c FROM analytics_events
            WHERE created_at BETWEEN ? AND ? AND event_name = 'signup_started'
              AND ${notTest}`,
    },
    {
      key: "registration",
      label: "Registration completed",
      sql: `SELECT COUNT(DISTINCT COALESCE(user_id, visitor_id)) AS c FROM analytics_events
            WHERE created_at BETWEEN ? AND ?
              AND event_name IN ('registration_completed','signup_completed')
              AND ${notTest}`,
    },
    {
      key: "onboarding_completed",
      label: "Onboarding completed",
      sql: `SELECT COUNT(DISTINCT user_id) AS c FROM analytics_events
            WHERE created_at BETWEEN ? AND ?
              AND user_id IS NOT NULL
              AND event_name = 'onboarding_completed'
              AND ${notTest}`,
    },
    {
      key: "first_lesson_started",
      label: "First lesson started",
      sql: `SELECT COUNT(*) AS c FROM (
              SELECT user_id FROM analytics_events
              WHERE user_id IS NOT NULL
                AND created_at BETWEEN ? AND ?
                AND event_name = 'first_lesson_started'
                AND ${notTest}
              GROUP BY user_id
              UNION
              SELECT user_id FROM (
                SELECT user_id, MIN(created_at) AS first_at
                FROM analytics_events
                WHERE user_id IS NOT NULL AND event_name = 'lesson_start'
                  AND ${notTest}
                GROUP BY user_id
              ) earliest
              WHERE earliest.first_at BETWEEN ? AND ?
                AND earliest.user_id NOT IN (
                  SELECT DISTINCT user_id FROM analytics_events
                  WHERE user_id IS NOT NULL AND event_name = 'first_lesson_started'
                    AND ${notTest}
                )
            ) t`,
    },
    {
      key: "first_lesson_completed",
      label: "First lesson completed",
      sql: `SELECT COUNT(*) AS c FROM (
              SELECT user_id FROM analytics_events
              WHERE user_id IS NOT NULL
                AND created_at BETWEEN ? AND ?
                AND event_name = 'first_lesson_completed'
                AND ${notTest}
              GROUP BY user_id
              UNION
              SELECT user_id FROM (
                SELECT user_id, MIN(created_at) AS first_at
                FROM analytics_events
                WHERE user_id IS NOT NULL AND event_name = 'lesson_complete'
                  AND ${notTest}
                GROUP BY user_id
              ) earliest
              WHERE earliest.first_at BETWEEN ? AND ?
                AND earliest.user_id NOT IN (
                  SELECT DISTINCT user_id FROM analytics_events
                  WHERE user_id IS NOT NULL AND event_name = 'first_lesson_completed'
                    AND ${notTest}
                )
            ) t`,
    },
    {
      key: "return_learn",
      label: "Returned on another local day",
      sql: `SELECT COUNT(*) AS c FROM (
              SELECT user_id FROM analytics_events
              WHERE created_at BETWEEN ? AND ?
                AND user_id IS NOT NULL
                AND event_name IN (${LEARNING_EVENTS_SQL})
                AND ${notTest}
              GROUP BY user_id
              HAVING COUNT(DISTINCT ${eventLocal}) >= 2
            ) t`,
    },
    {
      key: "paid",
      label: "Paid conversion",
      sql: `SELECT COUNT(DISTINCT user_id) AS c FROM analytics_events
            WHERE created_at BETWEEN ? AND ?
              AND event_name IN ('subscription_started','purchase')
              AND ${notTest}`,
    },
  ];

  const counts: number[] = [];
  for (const step of steps) {
    const params =
      step.key === "first_lesson_started" ||
      step.key === "first_lesson_completed"
        ? [from, to, from, to]
        : [from, to];
    const [rows] = await pool.query<(RowDataPacket & { c: unknown })[]>(
      step.sql,
      params,
    );
    counts.push(asNumber(rows[0]?.c));
  }

  return {
    steps: steps.map((s, i) => {
      const count = counts[i] ?? 0;
      const prev = i === 0 ? count : (counts[i - 1] ?? 0);
      const conversionFromPrev =
        i === 0 ? 1 : prev > 0 ? Number((count / prev).toFixed(4)) : null;
      const start = counts[0] ?? 0;
      const conversionFromStart =
        start > 0 ? Number((count / start).toFixed(4)) : null;
      const dropOffFromPrev =
        i === 0
          ? 0
          : conversionFromPrev == null
            ? null
            : Number((1 - conversionFromPrev).toFixed(4));
      return {
        key: s.key,
        label: s.label,
        definition: definitions[s.key] ?? "",
        count,
        conversionFromPrev,
        conversionFromStart,
        dropOffFromPrev,
      };
    }),
    definitions,
    reportingTimezone: tz,
    metricsAvailableFrom: METRICS_AVAILABLE_FROM,
    range: { from: from.toISOString(), to: to.toISOString() },
  };
}

/**
 * Cohort retention by registration week (reporting timezone).
 * Exact = learning activity on local date = reg + N.
 * Rolling = learning activity on any local date >= reg + N (cohort must be old enough).
 */
export async function getRetentionCohorts(params?: { weeks?: number }) {
  const pool = getDbPool();
  const weeks = Math.min(Math.max(params?.weeks ?? 8, 1), 26);
  const tz = reportingTimezoneLabel();
  const offset = getReportingTzOffsetMinutes();
  const regLocal = localDateCol("u.created_at");
  const cohortWeekExpr = `DATE_FORMAT(
      DATE_SUB(${regLocal}, INTERVAL WEEKDAY(${regLocal}) DAY),
      '%Y-%m-%d'
    )`;

  function dateOnly(value: unknown): string | null {
    if (value == null) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
    return m?.[1] ?? null;
  }

  function localTodayStr(): string {
    const localMs = Date.now() + offset * 60_000;
    return new Date(localMs).toISOString().slice(0, 10);
  }

  const [rows] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `
    SELECT
      ${cohortWeekExpr} AS cohort_week,
      COUNT(*) AS cohort_size,
      MIN(${regLocal}) AS cohort_min_reg,
      MAX(${regLocal}) AS cohort_max_reg,
      SUM(CASE WHEN exact_d1.user_id IS NOT NULL THEN 1 ELSE 0 END) AS exact_d1,
      SUM(CASE WHEN exact_d7.user_id IS NOT NULL THEN 1 ELSE 0 END) AS exact_d7,
      SUM(CASE WHEN exact_d30.user_id IS NOT NULL THEN 1 ELSE 0 END) AS exact_d30,
      SUM(CASE WHEN rolling_d1.user_id IS NOT NULL THEN 1 ELSE 0 END) AS rolling_d1,
      SUM(CASE WHEN rolling_d7.user_id IS NOT NULL THEN 1 ELSE 0 END) AS rolling_d7,
      SUM(CASE WHEN rolling_d30.user_id IS NOT NULL THEN 1 ELSE 0 END) AS rolling_d30
    FROM users u
    LEFT JOIN (
      SELECT DISTINCT e.user_id
      FROM analytics_events e
      JOIN users u2 ON u2.id = e.user_id
      WHERE e.event_name IN (${LEARNING_EVENTS_SQL})
        AND e.user_id IS NOT NULL
        AND ${localDateCol("e.created_at")} = DATE_ADD(${localDateCol("u2.created_at")}, INTERVAL 1 DAY)
    ) exact_d1 ON exact_d1.user_id = u.id
    LEFT JOIN (
      SELECT DISTINCT e.user_id
      FROM analytics_events e
      JOIN users u2 ON u2.id = e.user_id
      WHERE e.event_name IN (${LEARNING_EVENTS_SQL})
        AND e.user_id IS NOT NULL
        AND ${localDateCol("e.created_at")} = DATE_ADD(${localDateCol("u2.created_at")}, INTERVAL 7 DAY)
    ) exact_d7 ON exact_d7.user_id = u.id
    LEFT JOIN (
      SELECT DISTINCT e.user_id
      FROM analytics_events e
      JOIN users u2 ON u2.id = e.user_id
      WHERE e.event_name IN (${LEARNING_EVENTS_SQL})
        AND e.user_id IS NOT NULL
        AND ${localDateCol("e.created_at")} = DATE_ADD(${localDateCol("u2.created_at")}, INTERVAL 30 DAY)
    ) exact_d30 ON exact_d30.user_id = u.id
    LEFT JOIN (
      SELECT DISTINCT e.user_id
      FROM analytics_events e
      JOIN users u2 ON u2.id = e.user_id
      WHERE e.event_name IN (${LEARNING_EVENTS_SQL})
        AND e.user_id IS NOT NULL
        AND ${localDateCol("e.created_at")} >= DATE_ADD(${localDateCol("u2.created_at")}, INTERVAL 1 DAY)
    ) rolling_d1 ON rolling_d1.user_id = u.id
    LEFT JOIN (
      SELECT DISTINCT e.user_id
      FROM analytics_events e
      JOIN users u2 ON u2.id = e.user_id
      WHERE e.event_name IN (${LEARNING_EVENTS_SQL})
        AND e.user_id IS NOT NULL
        AND ${localDateCol("e.created_at")} >= DATE_ADD(${localDateCol("u2.created_at")}, INTERVAL 7 DAY)
    ) rolling_d7 ON rolling_d7.user_id = u.id
    LEFT JOIN (
      SELECT DISTINCT e.user_id
      FROM analytics_events e
      JOIN users u2 ON u2.id = e.user_id
      WHERE e.event_name IN (${LEARNING_EVENTS_SQL})
        AND e.user_id IS NOT NULL
        AND ${localDateCol("e.created_at")} >= DATE_ADD(${localDateCol("u2.created_at")}, INTERVAL 30 DAY)
    ) rolling_d30 ON rolling_d30.user_id = u.id
    WHERE u.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? WEEK)
    GROUP BY cohort_week
    ORDER BY cohort_week DESC
    `,
    [weeks],
  );

  const definitions = {
    exact:
      "Exact DN = at least one meaningful learning event on local date = registration local date + N.",
    rolling:
      "Rolling DN = at least one meaningful learning event on a local date ≥ registration local date + N. Rates are null until the cohort is at least N days old.",
    cohort:
      "Cohort week = Monday-start week of registration local date in the reporting timezone.",
    learningEvents: LEARNING_EVENTS.join(", "),
  };

  const todayLocalStr = localTodayStr();

  return {
    cohorts: rows.map((r) => {
      const size = asNumber(r.cohort_size);
      const exactD1 = asNumber(r.exact_d1);
      const exactD7 = asNumber(r.exact_d7);
      const exactD30 = asNumber(r.exact_d30);
      const rollingD1 = asNumber(r.rolling_d1);
      const rollingD7 = asNumber(r.rolling_d7);
      const rollingD30 = asNumber(r.rolling_d30);
      const maxReg = dateOnly(r.cohort_max_reg);
      const daysSinceMaxReg =
        maxReg != null
          ? Math.floor(
              (Date.parse(`${todayLocalStr}T00:00:00Z`) -
                Date.parse(`${maxReg}T00:00:00Z`)) /
                86_400_000,
            )
          : -1;
      const mature = (n: number, value: number | null) =>
        daysSinceMaxReg >= n ? value : null;

      return {
        cohortWeek: String(r.cohort_week),
        cohortSize: size,
        retainedExactD1: exactD1,
        retainedExactD7: exactD7,
        retainedExactD30: exactD30,
        retainedRollingD1: rollingD1,
        retainedRollingD7: rollingD7,
        retainedRollingD30: rollingD30,
        exactRateD1: mature(1, rate(exactD1, size)),
        exactRateD7: mature(7, rate(exactD7, size)),
        exactRateD30: mature(30, rate(exactD30, size)),
        rollingRateD1: mature(1, rate(rollingD1, size)),
        rollingRateD7: mature(7, rate(rollingD7, size)),
        rollingRateD30: mature(30, rate(rollingD30, size)),
      };
    }),
    definitions,
    retentionDefinition: `${definitions.exact} ${definitions.rolling}`,
    reportingTimezone: tz,
    metricsAvailableFrom: METRICS_AVAILABLE_FROM,
  };
}

/** First-touch organic_search acquisition → activation funnel. */
export async function getOrganicAcquisitionFunnel(range: DateRange) {
  const pool = getDbPool();
  const { from, to } = range;
  const tz = reportingTimezoneLabel();
  const eventLocal = localDateCol("e.created_at");
  const notTestEvent = sqlNotTestEvent("e");
  const notTestBare = sqlNotTestEvent();

  const organicVisitorJoin = `
    FROM analytics_visitors v
    LEFT JOIN analytics_attribution fa ON fa.visitor_id = v.id AND fa.touch = 'first'
    WHERE ${FIRST_CHANNEL_ORGANIC}
      AND IFNULL(v.first_utm_campaign, '') <> '__staging_verify__'
  `;

  const [[row]] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT
      (SELECT COUNT(*) ${organicVisitorJoin}
        AND v.first_seen_at BETWEEN ? AND ?) AS organic_visitors,
      (SELECT COUNT(DISTINCT COALESCE(e.user_id, e.visitor_id))
        FROM analytics_events e
        JOIN analytics_visitors v ON v.id = e.visitor_id
        LEFT JOIN analytics_attribution fa ON fa.visitor_id = v.id AND fa.touch = 'first'
        WHERE ${FIRST_CHANNEL_ORGANIC}
          AND e.created_at BETWEEN ? AND ?
          AND e.event_name IN ('registration_completed','signup_completed')
          AND ${notTestEvent}) AS organic_registrations,
      (SELECT COUNT(DISTINCT e.user_id)
        FROM analytics_events e
        JOIN analytics_visitors v ON v.id = e.visitor_id OR (e.user_id IS NOT NULL AND v.user_id = e.user_id)
        LEFT JOIN analytics_attribution fa ON fa.visitor_id = v.id AND fa.touch = 'first'
        WHERE ${FIRST_CHANNEL_ORGANIC}
          AND e.user_id IS NOT NULL
          AND e.created_at BETWEEN ? AND ?
          AND e.event_name = 'onboarding_completed'
          AND ${notTestEvent}) AS organic_onboarding,
      (SELECT COUNT(*) FROM (
          SELECT e.user_id
          FROM analytics_events e
          JOIN analytics_visitors v ON v.user_id = e.user_id
          LEFT JOIN analytics_attribution fa ON fa.visitor_id = v.id AND fa.touch = 'first'
          WHERE ${FIRST_CHANNEL_ORGANIC}
            AND e.user_id IS NOT NULL
            AND e.created_at BETWEEN ? AND ?
            AND e.event_name = 'first_lesson_started'
            AND ${notTestEvent}
          GROUP BY e.user_id
          UNION
          SELECT earliest.user_id FROM (
            SELECT e.user_id, MIN(e.created_at) AS first_at
            FROM analytics_events e
            WHERE e.user_id IS NOT NULL AND e.event_name = 'lesson_start'
              AND ${notTestEvent}
            GROUP BY e.user_id
          ) earliest
          JOIN analytics_visitors v ON v.user_id = earliest.user_id
          LEFT JOIN analytics_attribution fa ON fa.visitor_id = v.id AND fa.touch = 'first'
          WHERE ${FIRST_CHANNEL_ORGANIC}
            AND earliest.first_at BETWEEN ? AND ?
            AND earliest.user_id NOT IN (
              SELECT DISTINCT user_id FROM analytics_events
              WHERE user_id IS NOT NULL AND event_name = 'first_lesson_started'
            )
        ) t) AS organic_first_lesson_started,
      (SELECT COUNT(*) FROM (
          SELECT e.user_id
          FROM analytics_events e
          JOIN analytics_visitors v ON v.user_id = e.user_id
          LEFT JOIN analytics_attribution fa ON fa.visitor_id = v.id AND fa.touch = 'first'
          WHERE ${FIRST_CHANNEL_ORGANIC}
            AND e.user_id IS NOT NULL
            AND e.created_at BETWEEN ? AND ?
            AND e.event_name = 'first_lesson_completed'
            AND ${notTestEvent}
          GROUP BY e.user_id
          UNION
          SELECT earliest.user_id FROM (
            SELECT e.user_id, MIN(e.created_at) AS first_at
            FROM analytics_events e
            WHERE e.user_id IS NOT NULL AND e.event_name = 'lesson_complete'
              AND ${notTestEvent}
            GROUP BY e.user_id
          ) earliest
          JOIN analytics_visitors v ON v.user_id = earliest.user_id
          LEFT JOIN analytics_attribution fa ON fa.visitor_id = v.id AND fa.touch = 'first'
          WHERE ${FIRST_CHANNEL_ORGANIC}
            AND earliest.first_at BETWEEN ? AND ?
            AND earliest.user_id NOT IN (
              SELECT DISTINCT user_id FROM analytics_events
              WHERE user_id IS NOT NULL AND event_name = 'first_lesson_completed'
            )
        ) t) AS organic_first_lesson_completed,
      (SELECT COUNT(*) FROM (
          SELECT e.user_id
          FROM analytics_events e
          JOIN analytics_visitors v ON v.user_id = e.user_id
          LEFT JOIN analytics_attribution fa ON fa.visitor_id = v.id AND fa.touch = 'first'
          WHERE ${FIRST_CHANNEL_ORGANIC}
            AND e.user_id IS NOT NULL
            AND e.created_at BETWEEN ? AND ?
            AND e.event_name IN (${LEARNING_EVENTS_SQL})
          GROUP BY e.user_id
          HAVING COUNT(DISTINCT ${eventLocal}) >= 2
        ) t) AS organic_returning
    `,
    [
      from, to,
      from, to,
      from, to,
      from, to, from, to,
      from, to, from, to,
      from, to,
    ],
  );

  const organicVisitors = asNumber(row?.organic_visitors);
  const organicRegistrations = asNumber(row?.organic_registrations);
  const organicOnboardingCompleted = asNumber(row?.organic_onboarding);
  const organicFirstLessonStarted = asNumber(row?.organic_first_lesson_started);
  const organicFirstLessonCompleted = asNumber(
    row?.organic_first_lesson_completed,
  );
  const organicReturningLearners = asNumber(row?.organic_returning);

  return {
    organicVisitors,
    organicRegistrations,
    organicOnboardingCompleted,
    organicFirstLessonStarted,
    organicFirstLessonCompleted,
    organicReturningLearners,
    registrationRate: rate(organicRegistrations, organicVisitors),
    onboardingRate: rate(organicOnboardingCompleted, organicRegistrations),
    firstLessonStartRate: rate(
      organicFirstLessonStarted,
      organicOnboardingCompleted > 0
        ? organicOnboardingCompleted
        : organicRegistrations,
    ),
    firstLessonCompletionRate: rate(
      organicFirstLessonCompleted,
      organicFirstLessonStarted,
    ),
    returningRate: rate(organicReturningLearners, organicFirstLessonCompleted),
    channel: "organic_search" as const,
    definitions: {
      channel:
        "First-touch channel = organic_search via analytics_attribution.touch='first' or visitors.first_channel.",
      returning:
        "Users with meaningful learning activity on ≥2 distinct local reporting dates in range.",
    },
    reportingTimezone: tz,
    metricsAvailableFrom: METRICS_AVAILABLE_FROM,
    range: { from: from.toISOString(), to: to.toISOString() },
  };
}
