import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  applyDiscount,
  evaluateDiscount,
  normalizeDiscountCode,
  parseDiscountCodeInput,
  parsePlanKeys,
  type DiscountCode,
} from "./discounts.js";
import { previewRateLimitKey, resetPreviewRateLimit, takePreviewToken } from "./previewRateLimit.js";

const base: DiscountCode = {
  id: "c1",
  code: "SALE30",
  description: null,
  type: "percent",
  value: 30,
  planKeys: null,
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  maxPerUser: 1,
  firstPurchaseOnly: false,
  isActive: true,
  redemptionCount: 0,
};
const now = new Date("2026-11-11T12:00:00Z");
const ctx = {
  now,
  plan: "yearly" as const,
  reservedRedemptions: 0,
  user: { redemptions: 0, hasPurchased: false },
};

describe("applyDiscount", () => {
  it("percent, rounded down to whole toman", () => {
    assert.deepEqual(applyDiscount(6_990_000, "percent", 30), {
      listAmountRial: 6_990_000,
      discountAmountRial: 2_097_000,
      amountRial: 4_893_000,
    });
    assert.equal(applyDiscount(6_990_005, "percent", 33).discountAmountRial % 10, 0);
  });

  it("100% is free", () => {
    assert.equal(applyDiscount(59_900_000, "percent", 100).amountRial, 0);
  });

  it("fixed toman amount, capped at the price", () => {
    assert.equal(applyDiscount(6_990_000, "fixed", 100_000).amountRial, 5_990_000);
    assert.equal(applyDiscount(6_990_000, "fixed", 10_000_000).amountRial, 0);
  });

  it("raises a tiny non-zero total to the BitPay minimum", () => {
    const r = applyDiscount(6_990_000, "fixed", 698_900); // would leave 1,000 rial
    assert.equal(r.amountRial, 5_000);
    assert.equal(r.discountAmountRial, 6_985_000);
  });
});

describe("evaluateDiscount", () => {
  it("accepts a valid code", () => {
    const r = evaluateDiscount(base, 59_900_000, ctx);
    assert.equal(r.ok, true);
  });

  const rejects: [string, Partial<DiscountCode>, Partial<typeof ctx>][] = [
    ["inactive", { isActive: false }, {}],
    ["not_started", { startsAt: new Date("2026-12-01") }, {}],
    ["expired", { endsAt: new Date("2026-11-01") }, {}],
    ["plan_not_eligible", { planKeys: ["monthly"] }, {}],
    ["limit_reached", { maxRedemptions: 5 }, { reservedRedemptions: 5 }],
    ["already_used", {}, { user: { redemptions: 1, hasPurchased: false } }],
    ["first_purchase_only", { firstPurchaseOnly: true }, { user: { redemptions: 0, hasPurchased: true } }],
  ];
  for (const [reason, code, extra] of rejects) {
    it(`rejects: ${reason}`, () => {
      assert.deepEqual(evaluateDiscount({ ...base, ...code }, 59_900_000, { ...ctx, ...extra }), {
        ok: false,
        reason,
      });
    });
  }

  it("anonymous previews skip per-user rules", () => {
    const r = evaluateDiscount({ ...base, firstPurchaseOnly: true }, 59_900_000, { ...ctx, user: null });
    assert.equal(r.ok, true);
  });

  it("allows a second use when maxPerUser is 2", () => {
    const r = evaluateDiscount({ ...base, maxPerUser: 2 }, 59_900_000, {
      ...ctx,
      user: { redemptions: 1, hasPurchased: true },
    });
    assert.equal(r.ok, true);
  });
});

describe("code parsing", () => {
  it("normalizes codes", () => {
    assert.equal(normalizeDiscountCode("  sale-30 "), "SALE-30");
    assert.equal(normalizeDiscountCode("ab"), null);
    assert.equal(normalizeDiscountCode("bad code"), null);
    assert.equal(normalizeDiscountCode("کد"), null);
    assert.equal(normalizeDiscountCode(42), null);
  });

  it("plan list: empty or all plans means every plan", () => {
    assert.equal(parsePlanKeys(null), null);
    assert.equal(parsePlanKeys("monthly,every6Months,yearly"), null);
    assert.deepEqual(parsePlanKeys("yearly,nope"), ["yearly"]);
  });

  it("validates admin input", () => {
    const ok = parseDiscountCodeInput({ code: "gift100", type: "percent", value: 100 });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.input.code, "GIFT100");
      assert.equal(ok.input.maxPerUser, 1);
      assert.equal(ok.input.planKeys, null);
    }
    assert.equal(parseDiscountCodeInput({ code: "X1Y", type: "percent", value: 101 }).ok, false);
    assert.equal(parseDiscountCodeInput({ code: "X1Y", type: "fixed", value: 0 }).ok, false);
    assert.equal(parseDiscountCodeInput({ code: "X1Y", type: "free", value: 1 }).ok, false);
    assert.equal(
      parseDiscountCodeInput({
        code: "X1Y",
        type: "fixed",
        value: 5,
        startsAt: "2026-12-01",
        endsAt: "2026-11-01",
      }).ok,
      false,
    );
    assert.equal(
      parseDiscountCodeInput({ code: "X1Y", type: "fixed", value: 5, planKeys: ["lifetime"] }).ok,
      false,
    );
  });
});

describe("preview rate limit", () => {
  beforeEach(() => resetPreviewRateLimit());

  it("allows 20 previews per window, then blocks", () => {
    for (let i = 0; i < 20; i++) assert.equal(takePreviewToken("k", 0), true);
    assert.equal(takePreviewToken("k", 1), false);
    assert.equal(takePreviewToken("k", 10 * 60 * 1000 + 1), true);
  });

  it("keys by user, then by client ip", () => {
    const req = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } });
    assert.equal(previewRateLimitKey(req, "u1"), "u:u1");
    assert.equal(previewRateLimitKey(req, null), "ip:1.2.3.4");
  });
});
