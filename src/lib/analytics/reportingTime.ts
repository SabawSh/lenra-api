/** Default: Asia/Tehran, fixed UTC+03:30 (no DST). */
const DEFAULT_OFFSET_MINUTES = 210;

/**
 * Reporting calendar offset in minutes east of UTC.
 * Timestamps in analytics tables are stored as UTC; local dates use DATE_ADD.
 */
export function getReportingTzOffsetMinutes(): number {
  const raw = process.env.ANALYTICS_REPORTING_TZ_OFFSET_MINUTES;
  if (raw == null || raw === "") return DEFAULT_OFFSET_MINUTES;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : DEFAULT_OFFSET_MINUTES;
}

/** SQL expression: local calendar date of a UTC datetime column. */
export function sqlLocalDateExpr(columnSql: string): string {
  const n = getReportingTzOffsetMinutes();
  return `DATE(DATE_ADD(${columnSql}, INTERVAL ${n} MINUTE))`;
}

function formatUtcOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Human-readable reporting timezone for API/UI. */
export function reportingTimezoneLabel(): string {
  const offset = getReportingTzOffsetMinutes();
  const utc = formatUtcOffsetLabel(offset);
  if (offset === 210) return `Asia/Tehran (${utc})`;
  return utc;
}
