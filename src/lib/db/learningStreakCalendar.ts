/**
 * Calendar-day streak rules (no DB). A streak advances once per local day and
 * breaks only when a full calendar day is missed — not on a rolling 24h clock.
 */

/** Parse YYYY-MM-DD as a local calendar date (noon avoids DST edge cases). */
export function parseDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/**
 * Whole calendar days from `fromKey` to `toKey` (local).
 * 0 = same day, 1 = next day, 2+ = missed at least one day.
 */
export function calendarDayOffset(fromKey: string, toKey: string): number | null {
  const from = parseDayKey(fromKey);
  const to = parseDayKey(toKey);
  if (!from || !to) return null;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Streak dies when the last credited calendar day is before yesterday
 * (missed a full local day). Same day / yesterday still count as alive.
 */
export function isStreakExpiredByCalendar(
  row: {
    lastLearningStreakDayKey: string | null;
    learningStreakCurrent: number;
  },
  todayKey: string,
): boolean {
  if (row.learningStreakCurrent <= 0) return false;
  const lastKey = row.lastLearningStreakDayKey;
  if (!lastKey) return true;
  const offset = calendarDayOffset(lastKey, todayKey);
  if (offset == null) return true;
  return offset > 1;
}

/**
 * Next streak value when recording activity on `todayKey`.
 * - same day → keep current (at least 1)
 * - yesterday → current + 1
 * - gap / missing → 1
 */
export function nextStreakAfterActivity(params: {
  lastDayKey: string | null;
  current: number;
  todayKey: string;
}): number {
  const { lastDayKey, current, todayKey } = params;
  if (!lastDayKey || current <= 0) return 1;
  const offset = calendarDayOffset(lastDayKey, todayKey);
  if (offset == null) return 1;
  if (offset === 0) return Math.max(1, current);
  if (offset === 1) return current + 1;
  return 1;
}
