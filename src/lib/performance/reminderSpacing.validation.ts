/**
 * Reminder spacing — grow past 30 days on clean reviews, cap at 90.
 *
 *   npm run test:reminder-spacing
 */
import assert from "node:assert/strict";
import {
  baseDaysFromStrength,
  daysForReminderLevel,
  inferPreviousIntervalDays,
  nextGrownIntervalDays,
  snapToAllowed,
} from "./reminder/spacing";
import { MAX_REMINDER_DAYS, REMINDER_INTERVAL_DAYS } from "./reminder/types";
import { buildReminderOptions } from "./reminderSchedualer";
import type { PerformanceResult } from "@/types/learning";

assert.equal(MAX_REMINDER_DAYS, 90);
assert.ok(REMINDER_INTERVAL_DAYS.includes(90));
assert.ok(REMINDER_INTERVAL_DAYS.includes(45));
assert.ok(REMINDER_INTERVAL_DAYS.includes(60));

assert.equal(snapToAllowed(30), 30);
assert.equal(snapToAllowed(44), 45);
assert.equal(snapToAllowed(100), 90);

assert.equal(nextGrownIntervalDays(30), 45);
assert.equal(nextGrownIntervalDays(45), 60);
assert.equal(nextGrownIntervalDays(60), 90);
assert.equal(nextGrownIntervalDays(90), 90);
assert.equal(nextGrownIntervalDays(0), 1);

{
  const updatedAt = new Date(2026, 0, 1);
  const dueAt = new Date(2026, 0, 31); // 30 days later
  assert.equal(inferPreviousIntervalDays(dueAt, updatedAt), 30);
}

{
  const updatedAt = new Date(2026, 0, 1);
  const dueAt = new Date(2026, 0, 1); // same day
  assert.equal(inferPreviousIntervalDays(dueAt, updatedAt), 0);
}

assert.ok(baseDaysFromStrength(99) >= 45);

// Clean voice review after a 30-day interval → easy grows to 45 (not stuck at 30)
{
  const days = daysForReminderLevel(85, "voice", "easy", 30);
  assert.equal(days, 45, `expected 45 after clean 30d review, got ${days}`);
}

// Grow again: 45 → 60
{
  const days = daysForReminderLevel(88, "voice", "easy", 45);
  assert.equal(days, 60);
}

// Cap at 90
{
  const days = daysForReminderLevel(99, "voice", "easy", 90);
  assert.equal(days, 90);
}

// Struggle / hard after long interval shrinks
{
  const days = daysForReminderLevel(55, "voice", "hard", 30);
  assert.ok(days < 30, `hard should shrink from 30, got ${days}`);
}

// First review (no previous) still strength-based, never above 90
{
  const days = daysForReminderLevel(99, "voice", "easy", null);
  assert.ok(days <= 90);
  assert.ok(days >= 30);
}

{
  const perf: PerformanceResult = {
    score: 92,
    speed: 0.85,
    coverage: 1,
    level: "excellent",
    accuracy: 0.95,
    modeBonus: 1,
    durationSec: 40,
    inputMode: "voice",
    isPerfectRun: true,
    wrongMoves: 0,
    hintsUsed: 0,
  };
  const opts = buildReminderOptions(perf, { previousIntervalDays: 30 });
  const easy = opts.find((o) => o.level === "easy");
  assert.ok(easy);
  assert.equal(easy!.days, 45);
  assert.ok(easy!.days <= 90);
}

console.log("reminderSpacing.validation.ts: ok");
