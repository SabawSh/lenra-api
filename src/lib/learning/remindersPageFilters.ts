/**
 * Pure helpers for the Reminders page filters (date + title).
 * No DB — safe for client and unit tests.
 */

export type RemindersPageFilters = {
  /** Local calendar day as YYYY-MM-DD */
  date: string;
  /** Root video id (movie / series / documentary), or null = all titles */
  titleId: string | null;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Format a Date as local YYYY-MM-DD. */
export function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayLocalIsoDate(now: Date = new Date()): string {
  return toLocalIsoDate(now);
}

/** Parse `?date=` — invalid / missing → today. */
export function parseRemindersDateParam(
  raw: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!raw || !ISO_DAY.test(raw)) return todayLocalIsoDate(now);
  const [ys, ms, ds] = raw.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const probe = new Date(y, m - 1, d);
  if (
    Number.isNaN(probe.getTime()) ||
    probe.getFullYear() !== y ||
    probe.getMonth() !== m - 1 ||
    probe.getDate() !== d
  ) {
    return todayLocalIsoDate(now);
  }
  return raw;
}

/** Inclusive local-day bounds for SQL `due_at >= start AND due_at < end`. */
export function dayBoundsFromIsoDate(isoDate: string): {
  start: Date;
  end: Date;
} {
  const [ys, ms, ds] = isoDate.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 1);
  return { start, end };
}

/** First day of month → first day of next month (half-open). */
export function monthBounds(year: number, monthIndex0: number): {
  start: Date;
  end: Date;
} {
  const start = new Date(year, monthIndex0, 1);
  const end = new Date(year, monthIndex0 + 1, 1);
  return { start, end };
}

export function parseRemindersTitleId(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "all") return null;
  // Reject path injection / absurd lengths
  if (trimmed.length > 64 || /[^\w-]/.test(trimmed)) return null;
  return trimmed;
}

export function parseRemindersPageFilters(
  searchParams: { date?: string; titleId?: string },
  now: Date = new Date(),
): RemindersPageFilters {
  return {
    date: parseRemindersDateParam(searchParams.date, now),
    titleId: parseRemindersTitleId(searchParams.titleId),
  };
}

/** Build relative href for filter changes (no locale prefix). */
export function buildRemindersHref(filters: {
  date: string;
  titleId?: string | null;
}): string {
  const qs = new URLSearchParams();
  qs.set("date", filters.date);
  if (filters.titleId) qs.set("titleId", filters.titleId);
  const s = qs.toString();
  return s ? `/dashboard/reminders?${s}` : "/dashboard/reminders";
}

/** Days in a month grid (Sun-start or Mon-start filler nulls optional — we use simple list). */
export function listIsoDaysInMonth(year: number, monthIndex0: number): string[] {
  const days: string[] = [];
  const cursor = new Date(year, monthIndex0, 1);
  while (cursor.getMonth() === monthIndex0) {
    days.push(toLocalIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const { start } = dayBoundsFromIsoDate(isoDate);
  start.setDate(start.getDate() + deltaDays);
  return toLocalIsoDate(start);
}

export function monthLabelParts(isoDate: string): {
  year: number;
  monthIndex0: number;
} {
  const [ys, ms] = isoDate.split("-");
  return { year: Number(ys), monthIndex0: Number(ms) - 1 };
}
