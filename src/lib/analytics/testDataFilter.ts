/**
 * Staging / verify fixture isolation for first-party analytics.
 *
 * Fixture events are tagged with `properties.is_test = true` (see
 * `scripts/analyticsStagingVerify.ts`). Admin product queries exclude them by
 * default so funnel charts are not contaminated by incomplete seed chains.
 *
 * No schema change: `analytics_events.properties` already accepts arbitrary keys.
 */

/** SQL predicate: keep rows that are not tagged as test fixtures. */
export function sqlNotTestEvent(alias?: string): string {
  const col = alias ? `${alias}.properties` : "properties";
  // MySQL JSON booleans: compare with `= true`, not `= false` via IFNULL.
  return `NOT (JSON_EXTRACT(${col}, '$.is_test') <=> CAST('true' AS JSON))`;
}

/** UTM campaign stamped on fixture visitors for visitor-scoped cleanup. */
export const STAGING_VERIFY_UTM_CAMPAIGN = "__staging_verify__";
