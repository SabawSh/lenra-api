import type { PerformanceRaw } from "@/types/learning";

import type { ReminderSchedulingContext } from "./types";

export function reminderContextFromRaw(
  raw: Pick<PerformanceRaw, "attempts" | "videoDurationMs" | "totalWords">,
): ReminderSchedulingContext {
  return {
    attempts: raw.attempts,
    videoDurationMs: raw.videoDurationMs,
    chunkCount: raw.totalWords,
  };
}
