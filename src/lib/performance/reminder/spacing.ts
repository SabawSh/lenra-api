import type { InputMode, ReminderLevel } from "@/types/learning";

import {
  MAX_REMINDER_DAYS,
  REMINDER_INTERVAL_DAYS,
} from "./types";

const VOICE_CEILING: Record<ReminderLevel, number> = {
  hard: 7,
  normal: 45,
  easy: MAX_REMINDER_DAYS,
};

const DRAG_CEILING: Record<ReminderLevel, number> = {
  hard: 1,
  normal: 5,
  easy: 14,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Snap to the nearest allowed ladder step (within 0…MAX). */
export function snapToAllowed(days: number): number {
  const clamped = Math.max(0, Math.min(MAX_REMINDER_DAYS, days));
  let best: number = REMINDER_INTERVAL_DAYS[0]!;
  for (const d of REMINDER_INTERVAL_DAYS) {
    if (Math.abs(d - clamped) < Math.abs(best - clamped)) best = d;
  }
  return best;
}

/**
 * Infer the previously chosen interval from reminder timestamps.
 * When scheduled, due_at ≈ updated_at + interval; that span survives until the next upsert.
 */
export function inferPreviousIntervalDays(
  dueAt: Date,
  updatedAt: Date,
): number | null {
  const ms = dueAt.getTime() - updatedAt.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const days = Math.round(ms / MS_PER_DAY);
  if (days < 0) return null;
  if (days === 0) return 0;
  return snapToAllowed(days);
}

/** Next ladder step strictly above `previousDays`, capped at MAX. */
export function nextGrownIntervalDays(previousDays: number): number {
  const prev = Math.max(0, previousDays);
  for (const d of REMINDER_INTERVAL_DAYS) {
    if (d > prev) return Math.min(MAX_REMINDER_DAYS, d);
  }
  return MAX_REMINDER_DAYS;
}

/** Normal-option interval from memory strength (voice-scale bands). */
export function baseDaysFromStrength(strength: number): number {
  if (strength <= 20) return 0;
  if (strength <= 35) return 1;
  if (strength <= 50) return 3;
  if (strength <= 65) return 7;
  if (strength <= 80) return 14;
  if (strength <= 88) return 21;
  if (strength <= 93) return 30;
  if (strength <= 97) return 45;
  return 60;
}

/**
 * Drag solves cap earlier — recognition ≠ durable recall.
 * Maps strength as if memory were weaker for spacing purposes.
 */
export function effectiveStrengthForSpacing(
  strength: number,
  inputMode: InputMode,
): number {
  if (inputMode === "voice") return strength;
  return Math.max(0, Math.min(100, Math.round(strength * 0.68 - 14)));
}

function spreadDays(base: number, level: ReminderLevel): number {
  if (base <= 0) {
    return level === "easy" ? 2 : 0;
  }
  switch (level) {
    case "hard":
      return snapToAllowed(Math.floor(base * 0.4));
    case "normal":
      return snapToAllowed(base);
    case "easy":
      return snapToAllowed(Math.ceil(base * 1.75));
  }
}

/**
 * After a clean review, grow from the previous interval so strong cards
 * are not stuck at 30 forever (cap MAX_REMINDER_DAYS).
 * Growth is one ladder step per successful review — never a jump to the ceiling.
 */
function applySuccessGrowth(params: {
  strengthDays: number;
  level: ReminderLevel;
  previousIntervalDays: number;
  strength: number;
}): number {
  const { strengthDays, level, previousIntervalDays, strength } = params;
  const prev = Math.max(0, previousIntervalDays);

  if (level === "hard") {
    // Struggle self-report: shrink toward a short interval.
    return Math.min(
      strengthDays,
      snapToAllowed(Math.max(0, Math.floor(prev * 0.45))),
    );
  }

  if (level === "easy") {
    // Clean recall: advance exactly one ladder step past last interval.
    return Math.min(MAX_REMINDER_DAYS, nextGrownIntervalDays(prev));
  }

  // normal: keep previous if mid strength; grow one step when clearly solid.
  if (strength >= 72) {
    return Math.min(MAX_REMINDER_DAYS, nextGrownIntervalDays(prev));
  }
  return Math.min(MAX_REMINDER_DAYS, Math.max(strengthDays, snapToAllowed(prev)));
}

export function daysForReminderLevel(
  strength: number,
  inputMode: InputMode,
  level: ReminderLevel,
  previousIntervalDays?: number | null,
): number {
  const effective = effectiveStrengthForSpacing(strength, inputMode);
  const base = baseDaysFromStrength(effective);
  const ceiling =
    inputMode === "voice" ? VOICE_CEILING[level] : DRAG_CEILING[level];
  const strengthDays = Math.min(ceiling, spreadDays(base, level));

  if (
    previousIntervalDays == null ||
    previousIntervalDays < 1 ||
    strength < 50
  ) {
    return strengthDays;
  }

  const grown = applySuccessGrowth({
    strengthDays,
    level,
    previousIntervalDays,
    strength,
  });
  return Math.min(ceiling, grown);
}

/** Same-day struggle: soonest options, still lets user pick longer if they insist. */
export function sameDayReminderDays(
  inputMode: InputMode,
  level: ReminderLevel,
): number {
  const table =
    inputMode === "voice"
      ? ({ hard: 0, normal: 0, easy: 2 } as const)
      : ({ hard: 0, normal: 0, easy: 1 } as const);
  return table[level];
}
