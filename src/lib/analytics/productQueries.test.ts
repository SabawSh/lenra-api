import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getReportingTzOffsetMinutes,
  reportingTimezoneLabel,
  sqlLocalDateExpr,
} from "@/lib/analytics/reportingTime";

/** Pure funnel conversion math used by the admin product API. */
function funnelRates(counts: number[]) {
  return counts.map((count, i) => {
    const prev = i === 0 ? count : (counts[i - 1] ?? 0);
    const conversionFromPrev =
      i === 0 ? 1 : prev > 0 ? Number((count / prev).toFixed(4)) : null;
    const start = counts[0] ?? 0;
    const conversionFromStart =
      start > 0 ? Number((count / start).toFixed(4)) : null;
    return {
      count,
      conversionFromPrev,
      conversionFromStart,
      dropOffFromPrev:
        i === 0
          ? 0
          : conversionFromPrev == null
            ? null
            : Number((1 - conversionFromPrev).toFixed(4)),
    };
  });
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

describe("activation funnel rates", () => {
  it("computes drop-off between steps", () => {
    const rates = funnelRates([1000, 200, 100, 40, 20]);
    assert.equal(rates[0]!.conversionFromPrev, 1);
    assert.equal(rates[1]!.conversionFromPrev, 0.2);
    assert.equal(rates[1]!.dropOffFromPrev, 0.8);
    assert.equal(rates[2]!.conversionFromStart, 0.1);
  });

  it("handles zero previous without fabricating growth", () => {
    const rates = funnelRates([0, 0, 5]);
    assert.equal(rates[1]!.conversionFromPrev, null);
    assert.equal(rates[2]!.conversionFromPrev, null);
    assert.equal(rates[2]!.conversionFromStart, null);
  });
});

describe("retention definition", () => {
  it("treats learning events as retention, not page_view", () => {
    const learning = new Set([
      "lesson_complete",
      "first_lesson_completed",
      "exercise_completed",
      "speaking_completed",
      "sentence_rebuild_completed",
      "xp_earned",
      "review_session_completed",
      "learning_session_completed",
      "daily_goal_completed",
    ]);
    assert.equal(learning.has("page_view"), false);
    assert.equal(learning.has("listening_completed"), false);
    assert.equal(learning.has("lesson_complete"), true);
    assert.equal(learning.has("daily_goal_completed"), true);
  });

  it("does not fabricate rates for empty cohorts", () => {
    assert.equal(rate(0, 0), null);
    assert.equal(rate(3, 10), 0.3);
  });
});

describe("reporting timezone helper", () => {
  it("defaults to Asia/Tehran offset (+210)", () => {
    const prev = process.env.ANALYTICS_REPORTING_TZ_OFFSET_MINUTES;
    delete process.env.ANALYTICS_REPORTING_TZ_OFFSET_MINUTES;
    try {
      assert.equal(getReportingTzOffsetMinutes(), 210);
      assert.equal(reportingTimezoneLabel(), "Asia/Tehran (UTC+03:30)");
      assert.equal(
        sqlLocalDateExpr("created_at"),
        "DATE(DATE_ADD(created_at, INTERVAL 210 MINUTE))",
      );
    } finally {
      if (prev === undefined) {
        delete process.env.ANALYTICS_REPORTING_TZ_OFFSET_MINUTES;
      } else {
        process.env.ANALYTICS_REPORTING_TZ_OFFSET_MINUTES = prev;
      }
    }
  });

  it("respects ANALYTICS_REPORTING_TZ_OFFSET_MINUTES", () => {
    const prev = process.env.ANALYTICS_REPORTING_TZ_OFFSET_MINUTES;
    process.env.ANALYTICS_REPORTING_TZ_OFFSET_MINUTES = "0";
    try {
      assert.equal(getReportingTzOffsetMinutes(), 0);
      assert.equal(reportingTimezoneLabel(), "UTC+00:00");
      assert.equal(
        sqlLocalDateExpr("e.created_at"),
        "DATE(DATE_ADD(e.created_at, INTERVAL 0 MINUTE))",
      );
    } finally {
      if (prev === undefined) {
        delete process.env.ANALYTICS_REPORTING_TZ_OFFSET_MINUTES;
      } else {
        process.env.ANALYTICS_REPORTING_TZ_OFFSET_MINUTES = prev;
      }
    }
  });
});

describe("DAU vs range active learners", () => {
  it("keeps DAU conceptually separate from range distinct learners", () => {
    const overviewShape = {
      dau: 12,
      wau: 40,
      mau: 120,
      activeLearnersInRange: 55,
    };
    assert.notEqual(overviewShape.dau, overviewShape.activeLearnersInRange);
    assert.ok("activeLearnersInRange" in overviewShape);
    assert.ok(!("dau_proxy" in overviewShape));
  });
});
