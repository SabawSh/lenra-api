const DEFAULT_APP_TIME_ZONE = "Asia/Tehran";

/** IANA zone that defines learners' calendar days (streaks, XP, reminders). */
export function appTimeZone(): string {
  return process.env.APP_TIME_ZONE?.trim() || DEFAULT_APP_TIME_ZONE;
}

/**
 * Run the process clock in the app zone so local `Date` getters and
 * `new Date(y, m, d)` follow learners' days. DB I/O stays UTC (see connection.ts).
 */
export function applyAppTimeZone(): void {
  process.env.TZ = appTimeZone();
}

/** Process-local UTC offset as `+03:30`, for MySQL `CONVERT_TZ(col, '+00:00', ?)`. */
export function appTimeZoneSqlOffset(at: Date = new Date()): string {
  const minutes = -at.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}
