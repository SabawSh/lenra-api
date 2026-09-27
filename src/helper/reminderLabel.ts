import type { ReminderLevel } from "@/types/learning";

type TranslateFn = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

/** Card subtitle: when to review (0 days → “today”, not “0 days”). */
export function reviewInDaysLabel(days: number, t: TranslateFn): string {
  if (days <= 0) return t("reviewToday");
  if (days === 1) return t("reviewTomorrow");
  return t("reviewInDays", { days });
}

/** Post-selection confirmation line in the success modal. */
export function scheduleConfirmationLabel(
  level: ReminderLevel,
  days: number,
  t: TranslateFn,
): string {
  if (days <= 0) return t(`scheduleToday.${level}`);
  return t(`schedule.${level}`, { days });
}
