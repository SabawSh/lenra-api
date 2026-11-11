import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createCheckoutState, verifyCheckoutState } from "./checkoutState.js";
import {
  isBitpaySuccessStatus,
  matchVerifyToOrder,
  newFactorId,
} from "./orderVerification.js";
import type { UserId } from "@/types/schema";

const expected = { amountRial: 6_990_000, factorId: 176_000_000_000_042, getId: 555 };

describe("matchVerifyToOrder", () => {
  it("accepts an exact echo", () => {
    assert.deepEqual(
      matchVerifyToOrder({
        expected,
        callbackGetId: 555,
        verify: { amount: 6_990_000, factorId: "176000000000042", get_id: 555 },
      }),
      { ok: true },
    );
  });

  it("accepts when BitPay omits the optional fields", () => {
    assert.deepEqual(
      matchVerifyToOrder({ expected, callbackGetId: 555, verify: {} }),
      { ok: true },
    );
  });

  it("rejects a cheaper payment replayed for an expensive order", () => {
    assert.deepEqual(
      matchVerifyToOrder({
        expected: { ...expected, amountRial: 59_900_000 },
        callbackGetId: 555,
        verify: { amount: 6_990_000 },
      }),
      { ok: false, reason: "amount_mismatch" },
    );
  });

  it("rejects an amount sent as a string that differs", () => {
    assert.equal(
      matchVerifyToOrder({
        expected,
        callbackGetId: 555,
        verify: { amount: "5000" as unknown as number },
      }).ok,
      false,
    );
  });

  it("rejects a different id_get in the callback or the echo", () => {
    assert.deepEqual(
      matchVerifyToOrder({ expected, callbackGetId: 556, verify: {} }),
      { ok: false, reason: "get_id_mismatch" },
    );
    assert.deepEqual(
      matchVerifyToOrder({ expected, callbackGetId: 555, verify: { get_id: 9 } }),
      { ok: false, reason: "get_id_mismatch" },
    );
  });

  it("rejects another invoice's factorId", () => {
    assert.deepEqual(
      matchVerifyToOrder({ expected, callbackGetId: 555, verify: { factorId: "1" } }),
      { ok: false, reason: "factor_mismatch" },
    );
  });

  it("legacy checks only the amount", () => {
    const legacy = { amountRial: 6_990_000, factorId: null, getId: null };
    assert.equal(
      matchVerifyToOrder({ expected: legacy, callbackGetId: 1, verify: { factorId: "9" } }).ok,
      true,
    );
    assert.equal(
      matchVerifyToOrder({ expected: legacy, callbackGetId: 1, verify: { amount: 5000 } }).ok,
      false,
    );
  });
});

describe("payment helpers", () => {
  it("treats 1 and 11 as paid", () => {
    assert.equal(isBitpaySuccessStatus(1), true);
    assert.equal(isBitpaySuccessStatus(11), true);
    assert.equal(isBitpaySuccessStatus(-4), false);
  });

  it("factor ids are safe integers", () => {
    const id = newFactorId();
    assert.ok(Number.isSafeInteger(id));
    assert.ok(id > Date.now() * 99);
  });
});

describe("checkout state orderId", () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    process.env.AUTH_SECRET = "x".repeat(48);
  });
  afterEach(() => {
    process.env = ENV;
  });

  const userId = "11111111-2222-3333-4444-555555555555" as UserId;
  const orderId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("round-trips the order id", () => {
    const state = createCheckoutState({ userId, plan: "yearly", locale: "fa", orderId });
    assert.deepEqual(verifyCheckoutState(state), {
      userId,
      plan: "yearly",
      locale: "fa",
      orderId,
    });
  });

  it("still accepts legacy states without an order", () => {
    const state = createCheckoutState({ userId, plan: "monthly", locale: "en" });
    assert.deepEqual(verifyCheckoutState(state), { userId, plan: "monthly", locale: "en" });
  });

  it("rejects a tampered state", () => {
    const state = createCheckoutState({ userId, plan: "monthly", locale: "fa", orderId });
    const [body, sig] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body!, "base64url").toString()),
        plan: "yearly",
      }),
    ).toString("base64url");
    assert.equal(verifyCheckoutState(`${forged}.${sig}`), null);
  });
});

describe("checkout return page", () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    process.env.AUTH_SECRET = "x".repeat(48);
  });
  afterEach(() => {
    process.env = ENV;
  });

  it("carries the dashboard return through the signed state", async () => {
    const userId = "11111111-2222-3333-4444-555555555555" as UserId;
    const state = createCheckoutState({ userId, plan: "monthly", locale: "fa", returnTo: "dashboard" });
    assert.equal(verifyCheckoutState(state)?.returnTo, "dashboard");
    const plain = createCheckoutState({ userId, plan: "monthly", locale: "fa" });
    assert.equal(verifyCheckoutState(plain)?.returnTo, undefined);
  });

  it("builds the result URL for the page the checkout came from", async () => {
    const { pricingUrl, parseCheckoutReturnTo } = await import("./publicOrigin.js");
    const q = new URLSearchParams({ payment: "success" });
    assert.equal(
      pricingUrl("fa", "https://lenra.ir", q, "dashboard").toString(),
      "https://lenra.ir/dashboard/plans?payment=success",
    );
    assert.equal(
      pricingUrl("en", "https://lenra.ir", q, "dashboard").toString(),
      "https://lenra.ir/en/dashboard/plans?payment=success",
    );
    assert.equal(pricingUrl("fa", "https://lenra.ir", q).pathname, "/pricing");
    assert.equal(parseCheckoutReturnTo("evil"), "pricing");
  });
});
