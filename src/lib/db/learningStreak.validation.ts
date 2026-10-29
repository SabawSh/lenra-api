/**
 *   npx tsx src/lib/db/learningStreak.validation.ts
 */
import {
  calendarDayOffset,
  isStreakExpiredByCalendar,
  nextStreakAfterActivity,
} from "./learningStreakCalendar";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

{
  assert(calendarDayOffset("2026-10-27", "2026-10-27") === 0, "same day");
  assert(calendarDayOffset("2026-10-27", "2026-10-28") === 1, "next day");
  assert(calendarDayOffset("2026-10-27", "2026-10-29") === 2, "skipped a day");
}

{
  // Practice Mon 10:00, Tue 11:00, Wed 12:00 — wall-clock >24h between days,
  // but consecutive calendar days must still grow the streak.
  let current = nextStreakAfterActivity({
    lastDayKey: null,
    current: 0,
    todayKey: "2026-10-27",
  });
  assert(current === 1, `day1 → 1, got ${current}`);

  current = nextStreakAfterActivity({
    lastDayKey: "2026-10-27",
    current,
    todayKey: "2026-10-28",
  });
  assert(current === 2, `day2 → 2, got ${current}`);

  current = nextStreakAfterActivity({
    lastDayKey: "2026-10-28",
    current,
    todayKey: "2026-10-29",
  });
  assert(current === 3, `day3 → 3, got ${current}`);

  const sameDay = nextStreakAfterActivity({
    lastDayKey: "2026-10-29",
    current: 3,
    todayKey: "2026-10-29",
  });
  assert(sameDay === 3, `same day keeps 3, got ${sameDay}`);
}

{
  assert(
    !isStreakExpiredByCalendar(
      { lastLearningStreakDayKey: "2026-10-28", learningStreakCurrent: 2 },
      "2026-10-29",
    ),
    "yesterday's streak must still be alive today before practice",
  );
  assert(
    isStreakExpiredByCalendar(
      { lastLearningStreakDayKey: "2026-10-27", learningStreakCurrent: 2 },
      "2026-10-29",
    ),
    "skipping a calendar day must expire the streak",
  );
}

process.stdout.write("learningStreak.validation: all passed\n");
