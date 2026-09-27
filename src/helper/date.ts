import { getNumberLocale } from "@/helper/number";
import { ReminderOption } from "@/types/learning";

/** Full weekday name for fa; short for other locales (study-time week axis). */
export function weekdayChartLabel(dateKey: string, locale: string): string {
  const [yy, mm, dd] = dateKey.split("-").map(Number);
  const d = new Date(yy, mm - 1, dd);
  const isFa = locale.toLowerCase().startsWith("fa");
  return new Intl.DateTimeFormat(getNumberLocale(locale), {
    weekday: isFa ? "long" : "short",
  }).format(d);
}

/** Compact tick label for dense day/month axes (keeps leading day number). */
export function chartDayTickLabel(raw: string): string {
  const s = String(raw ?? "").trim();
  const digits = s.match(/^[\u06F0-\u06F9\u0660-\u0669\d]+/);
  if (digits) return digits[0];
  const maxLen = 5;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export function resolveDueAt(opt: ReminderOption) {
  const now = new Date();
  return new Date(now.getTime() + opt.days * 24 * 60 * 60 * 1000);
}
