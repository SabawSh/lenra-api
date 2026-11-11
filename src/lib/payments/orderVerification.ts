import type { BitpayVerifyResult } from "@/lib/payments/bitpay";

/** BitPay verify statuses that mean "money was received". */
export function isBitpaySuccessStatus(status: number): boolean {
  return status === 1 || status === 11;
}

export type OrderMatchFailure =
  | "get_id_mismatch"
  | "amount_mismatch"
  | "factor_mismatch";

export interface ExpectedPayment {
  amountRial: number;
  /** Null for legacy (pre-order) checkouts, which used Date.now() factors. */
  factorId: number | null;
  /** Null when the gateway id was never stored (legacy checkouts). */
  getId: number | null;
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^\s*\d+\s*$/.test(value)) {
    return Number(value.trim());
  }
  return null;
}

/**
 * Checks a successful BitPay verify result against what the server expected.
 *
 * Every field BitPay echoes back must match. Missing fields are tolerated
 * (BitPay does not always echo them), but the id_get from the callback query
 * must always match the one stored when the payment was started.
 */
export function matchVerifyToOrder(params: {
  expected: ExpectedPayment;
  callbackGetId: number;
  verify: Pick<BitpayVerifyResult, "amount" | "factorId" | "get_id">;
}): { ok: true } | { ok: false; reason: OrderMatchFailure } {
  const { expected, callbackGetId, verify } = params;

  if (expected.getId !== null && expected.getId !== callbackGetId) {
    return { ok: false, reason: "get_id_mismatch" };
  }
  const echoedGetId = toInt(verify.get_id);
  if (
    expected.getId !== null &&
    echoedGetId !== null &&
    echoedGetId !== expected.getId
  ) {
    return { ok: false, reason: "get_id_mismatch" };
  }

  const amount = toInt(verify.amount);
  if (amount !== null && amount !== expected.amountRial) {
    return { ok: false, reason: "amount_mismatch" };
  }

  const factor = toInt(verify.factorId);
  if (
    expected.factorId !== null &&
    factor !== null &&
    factor !== expected.factorId
  ) {
    return { ok: false, reason: "factor_mismatch" };
  }

  return { ok: true };
}

/**
 * A unique numeric invoice id for BitPay: millisecond clock * 100 plus a
 * random suffix. ~15 digits, well inside Number.MAX_SAFE_INTEGER.
 */
export function newFactorId(now = Date.now()): number {
  return now * 100 + Math.floor(Math.random() * 100);
}
