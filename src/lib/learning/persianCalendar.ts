/**
 * Persian (Jalali) calendar helpers via Intl — no extra deps.
 * Storage / URLs stay Gregorian ISO (YYYY-MM-DD).
 */

import { dayBoundsFromIsoDate, toLocalIsoDate } from "./remindersPageFilters";

export type CalendarKind = "persian" | "gregorian";

export type CalendarYmd = {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
};

const persianPartsFmt = new Intl.DateTimeFormat("en-US-u-ca-persian", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

function partsToYmd(parts: Intl.DateTimeFormatPart[]): CalendarYmd {
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const year = Number(String(map.year ?? "").replace(/\D/g, ""));
  const month = Number(map.month);
  const day = Number(map.day);
  if (!year || !month || !day) {
    throw new Error("persianCalendar: failed to parse Intl parts");
  }
  return { year, month, day };
}

function localNoon(y: number, m0: number, d: number): Date {
  return new Date(y, m0, d, 12, 0, 0, 0);
}

export function toPersianYmd(date: Date): CalendarYmd {
  const noon = localNoon(date.getFullYear(), date.getMonth(), date.getDate());
  return partsToYmd(persianPartsFmt.formatToParts(noon));
}

export function isoToPersianYmd(isoDate: string): CalendarYmd {
  return toPersianYmd(dayBoundsFromIsoDate(isoDate).start);
}

function comparePersian(a: CalendarYmd, b: CalendarYmd): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

/** Find Gregorian local date for Persian day 1 of a given month. */
function findPersianMonthStart(jy: number, jm: number): Date {
  const target: CalendarYmd = { year: jy, month: jm, day: 1 };
  // Safe Gregorian window around the Jalali year
  let lo = localNoon(jy + 621, 0, 1);
  let hi = localNoon(jy + 623, 11, 31);

  while (toLocalIsoDate(lo) <= toLocalIsoDate(hi)) {
    const midMs =
      lo.getTime() + Math.floor((hi.getTime() - lo.getTime()) / 2);
    const mid = new Date(midMs);
    const noon = localNoon(mid.getFullYear(), mid.getMonth(), mid.getDate());
    const cmp = comparePersian(toPersianYmd(noon), target);
    if (cmp === 0) return noon;
    if (cmp < 0) {
      lo = localNoon(noon.getFullYear(), noon.getMonth(), noon.getDate() + 1);
    } else {
      hi = localNoon(noon.getFullYear(), noon.getMonth(), noon.getDate() - 1);
    }
  }
  throw new Error(`persianCalendar: month start not found for ${jy}/${jm}`);
}

/**
 * Convert Persian Y/M/D → local Gregorian Date (local midnight via noon anchor).
 */
export function fromPersianYmd(y: number, m: number, d: number): Date {
  const start = findPersianMonthStart(y, m);
  const result = localNoon(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + (d - 1),
  );
  const check = toPersianYmd(result);
  if (check.year !== y || check.month !== m || check.day !== d) {
    throw new Error(`persianCalendar: no Gregorian day for ${y}-${m}-${d}`);
  }
  return localNoon(result.getFullYear(), result.getMonth(), result.getDate());
}

export function persianYmdToIso(y: number, m: number, d: number): string {
  return toLocalIsoDate(fromPersianYmd(y, m, d));
}

/** Days in a Persian month (1–12). Esfand (12) is 29 or 30. */
export function persianMonthLength(year: number, month: number): number {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  try {
    fromPersianYmd(year, 12, 30);
    return 30;
  } catch {
    return 29;
  }
}

export function shiftPersianMonth(
  y: number,
  m: number,
  delta: number,
): { year: number; month: number } {
  const idx = y * 12 + (m - 1) + delta;
  const year = Math.floor(idx / 12);
  const month = ((idx % 12) + 12) % 12;
  return { year, month: month + 1 };
}

export type CalendarDayCell = {
  /** Gregorian ISO for filtering / URL */
  iso: string;
  /** Day number shown in the grid (Persian or Gregorian) */
  displayDay: number;
  /** Outside the focused month (leading/trailing padding) */
  outside: boolean;
};

/**
 * Build a Sat→Fri (Persian) or Sun→Sat (Gregorian) month grid with padding cells.
 */
export function buildMonthGrid(params: {
  kind: CalendarKind;
  /** Any ISO day inside the month to display */
  focusIso: string;
}): {
  year: number;
  month: number;
  titleIso: string;
  days: CalendarDayCell[];
  rangeStart: Date;
  rangeEnd: Date;
} {
  if (params.kind === "persian") {
    const focus = isoToPersianYmd(params.focusIso);
    const len = persianMonthLength(focus.year, focus.month);
    const first = fromPersianYmd(focus.year, focus.month, 1);
    const last = fromPersianYmd(focus.year, focus.month, len);
    // Saturday = 6 in JS → pad so week starts Saturday
    const padStart = (first.getDay() + 1) % 7;
    const days: CalendarDayCell[] = [];

    for (let i = 0; i < padStart; i++) {
      const d = localNoon(
        first.getFullYear(),
        first.getMonth(),
        first.getDate() - (padStart - i),
      );
      const p = toPersianYmd(d);
      days.push({
        iso: toLocalIsoDate(d),
        displayDay: p.day,
        outside: true,
      });
    }
    for (let day = 1; day <= len; day++) {
      const d = fromPersianYmd(focus.year, focus.month, day);
      days.push({
        iso: toLocalIsoDate(d),
        displayDay: day,
        outside: false,
      });
    }
    while (days.length % 7 !== 0) {
      const prev = days[days.length - 1]!;
      const base = dayBoundsFromIsoDate(prev.iso).start;
      const d = localNoon(
        base.getFullYear(),
        base.getMonth(),
        base.getDate() + 1,
      );
      const p = toPersianYmd(d);
      days.push({
        iso: toLocalIsoDate(d),
        displayDay: p.day,
        outside: true,
      });
    }

    const rangeEnd = localNoon(
      last.getFullYear(),
      last.getMonth(),
      last.getDate() + 1,
    );

    return {
      year: focus.year,
      month: focus.month,
      titleIso: toLocalIsoDate(first),
      days,
      rangeStart: localNoon(
        first.getFullYear(),
        first.getMonth(),
        first.getDate(),
      ),
      rangeEnd,
    };
  }

  const { start: focusDate } = dayBoundsFromIsoDate(params.focusIso);
  const year = focusDate.getFullYear();
  const month = focusDate.getMonth() + 1;
  const first = localNoon(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();
  const padStart = first.getDay();
  const days: CalendarDayCell[] = [];

  for (let i = 0; i < padStart; i++) {
    const d = localNoon(year, month - 1, 1 - (padStart - i));
    days.push({
      iso: toLocalIsoDate(d),
      displayDay: d.getDate(),
      outside: true,
    });
  }
  for (let day = 1; day <= lastDay; day++) {
    const d = localNoon(year, month - 1, day);
    days.push({
      iso: toLocalIsoDate(d),
      displayDay: day,
      outside: false,
    });
  }
  while (days.length % 7 !== 0) {
    const prev = days[days.length - 1]!;
    const base = dayBoundsFromIsoDate(prev.iso).start;
    const d = localNoon(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + 1,
    );
    days.push({
      iso: toLocalIsoDate(d),
      displayDay: d.getDate(),
      outside: true,
    });
  }

  return {
    year,
    month,
    titleIso: toLocalIsoDate(first),
    days,
    rangeStart: first,
    rangeEnd: localNoon(year, month, 1),
  };
}

export function formatCalendarMonthTitle(
  kind: CalendarKind,
  focusIso: string,
  locale: string,
): string {
  if (kind === "persian") {
    const p = isoToPersianYmd(focusIso);
    const mid = fromPersianYmd(
      p.year,
      p.month,
      Math.min(15, persianMonthLength(p.year, p.month)),
    );
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      month: "long",
      year: "numeric",
    }).format(mid);
  }
  const { start } = dayBoundsFromIsoDate(focusIso);
  return new Intl.DateTimeFormat(locale.startsWith("fa") ? "fa-IR" : "en-US", {
    month: "long",
    year: "numeric",
  }).format(start);
}

export function formatSelectedDayHeadline(
  kind: CalendarKind,
  isoDate: string,
  locale: string,
): string {
  const { start } = dayBoundsFromIsoDate(isoDate);
  if (kind === "persian") {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(start);
  }
  return new Intl.DateTimeFormat(locale.startsWith("fa") ? "fa-IR" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(start);
}

export function calendarKindForLocale(locale: string): CalendarKind {
  return locale.toLowerCase().startsWith("fa") ? "persian" : "gregorian";
}

/** Shift the focused month; keep a similar day-of-month when possible. */
export function shiftFocusMonthIso(
  kind: CalendarKind,
  focusIso: string,
  deltaMonths: number,
): string {
  if (kind === "persian") {
    const p = isoToPersianYmd(focusIso);
    const next = shiftPersianMonth(p.year, p.month, deltaMonths);
    const len = persianMonthLength(next.year, next.month);
    const day = Math.min(p.day, len);
    return persianYmdToIso(next.year, next.month, day);
  }
  const { start } = dayBoundsFromIsoDate(focusIso);
  const day = start.getDate();
  const next = localNoon(
    start.getFullYear(),
    start.getMonth() + deltaMonths,
    1,
  );
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  return toLocalIsoDate(
    localNoon(next.getFullYear(), next.getMonth(), Math.min(day, last)),
  );
}
