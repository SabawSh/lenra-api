import type { PerformanceResult, ReminderOption } from "@/types/learning";

import { reminderContextFromRaw } from "./reminder/context";
import {
  computeMemoryStrength,
  recommendedReminderLevel,
  requiresSameDayReview,
} from "./reminder/memoryStrength";
import {
  daysForReminderLevel,
  sameDayReminderDays,
} from "./reminder/spacing";
import type { ReminderSchedulingContext } from "./reminder/types";

export type { ReminderSchedulingContext } from "./reminder/types";
export { reminderContextFromRaw } from "./reminder/context";

const OPTION_ORDER: ReminderOption["level"][] = ["easy", "normal", "hard"];

/**
 * Adaptive spaced-repetition choices from learner struggle only.
 * No clip/sentence difficulty — memory strength drives every interval.
 * Clean successive reviews grow past the previous interval (up to 90 days).
 */
export function buildReminderOptions(
  performance: PerformanceResult,
  context?: ReminderSchedulingContext,
): ReminderOption[] {
  const strength = computeMemoryStrength(performance, context);
  const sameDay = requiresSameDayReview(performance, strength, context);
  const recommended = recommendedReminderLevel(performance, strength);
  const previousIntervalDays = context?.previousIntervalDays ?? null;

  return OPTION_ORDER.map((level) => ({
    level,
    days: sameDay
      ? sameDayReminderDays(performance.inputMode, level)
      : daysForReminderLevel(
          strength,
          performance.inputMode,
          level,
          previousIntervalDays,
        ),
    recommended: level === recommended,
  }));
}

/** Build options from a finished round (performance + session raw). */
export function buildReminderOptionsForSession(
  performance: PerformanceResult,
  raw: Pick<
    import("@/types/learning").PerformanceRaw,
    "attempts" | "videoDurationMs" | "totalWords"
  >,
  extra?: Pick<ReminderSchedulingContext, "previousIntervalDays">,
): ReminderOption[] {
  return buildReminderOptions(performance, {
    ...reminderContextFromRaw(raw),
    previousIntervalDays: extra?.previousIntervalDays,
  });
}
