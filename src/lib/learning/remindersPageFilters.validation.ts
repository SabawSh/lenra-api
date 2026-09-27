/**
 * Persian calendar + reminders filter helpers.
 *
 *   npm run test:reminders-page-filters
 */
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import {
  buildMonthGrid,
  formatCalendarMonthTitle,
  formatSelectedDayHeadline,
  isoToPersianYmd,
  persianYmdToIso,
  toPersianYmd,
} from "./persianCalendar";
import {
  buildRemindersHref,
  dayBoundsFromIsoDate,
  parseRemindersDateParam,
  parseRemindersPageFilters,
  parseRemindersTitleId,
  todayLocalIsoDate,
  toLocalIsoDate,
} from "./remindersPageFilters";

const fixed = new Date(2026, 8, 23); // Sep 23, 2026 = 1 Mehr 1405

assert.equal(toLocalIsoDate(fixed), "2026-09-23");
assert.equal(todayLocalIsoDate(fixed), "2026-09-23");

// Persian: 23 Sep 2026 → 1 Mehr 1405 (NOT Shahrivar)
{
  const p = toPersianYmd(fixed);
  assert.equal(p.year, 1405);
  assert.equal(p.month, 7, "Mehr is month 7");
  assert.equal(p.day, 1);
  assert.equal(persianYmdToIso(1405, 7, 1), "2026-09-23");
  assert.deepEqual(isoToPersianYmd("2026-09-23"), {
    year: 1405,
    month: 7,
    day: 1,
  });
}

{
  const grid = buildMonthGrid({
    kind: "persian",
    focusIso: "2026-09-23",
  });
  assert.equal(grid.year, 1405);
  assert.equal(grid.month, 7);
  assert.equal(grid.days.filter((d) => !d.outside).length, 30);
  const first = grid.days.find((d) => !d.outside);
  assert.equal(first?.iso, "2026-09-23");
  assert.equal(first?.displayDay, 1);

  const title = formatCalendarMonthTitle("persian", "2026-09-23", "fa");
  assert.match(title, /مهر/);
  assert.doesNotMatch(title, /شهریور/);

  const headline = formatSelectedDayHeadline("persian", "2026-09-23", "fa");
  assert.match(headline, /مهر/);
  assert.match(headline, /۱|1/);
}

assert.equal(parseRemindersDateParam(undefined, fixed), "2026-09-23");
assert.equal(parseRemindersDateParam("bad", fixed), "2026-09-23");
assert.equal(parseRemindersDateParam("2026-02-31", fixed), "2026-09-23");
assert.equal(parseRemindersDateParam("2026-09-15", fixed), "2026-09-15");

{
  const { start, end } = dayBoundsFromIsoDate("2026-09-23");
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 8);
  assert.equal(start.getDate(), 23);
  assert.equal(end.getDate(), 24);
}

assert.equal(parseRemindersTitleId(undefined), null);
assert.equal(parseRemindersTitleId("all"), null);
assert.equal(parseRemindersTitleId("../x"), null);
assert.equal(parseRemindersTitleId("abc-123"), "abc-123");

{
  const f = parseRemindersPageFilters(
    { date: "2026-09-10", titleId: "vid1" },
    fixed,
  );
  assert.deepEqual(f, { date: "2026-09-10", titleId: "vid1" });
}

assert.equal(
  buildRemindersHref({ date: "2026-09-23" }),
  "/dashboard/reminders?date=2026-09-23",
);
assert.equal(
  buildRemindersHref({ date: "2026-09-23", titleId: "coraline" }),
  "/dashboard/reminders?date=2026-09-23&titleId=coraline",
);

{
  const ui = readFileSync(
    join(
      process.cwd(),
      "components/organisms/episodeSections/MovieLearningBatchExperience.tsx",
    ),
    "utf8",
  );
  assert.match(ui, /\/dashboard\/reminders/);
}

{
  const page = readFileSync(
    join(process.cwd(), "app/[locale]/(home)/dashboard/reminders/page.tsx"),
    "utf8",
  );
  assert.match(page, /loadRemindersPage/);
  assert.match(page, /getLocale/);
}

console.log("remindersPageFilters.validation.ts: ok");
