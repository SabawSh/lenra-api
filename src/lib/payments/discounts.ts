import type { BitpayPlanKey } from "@/lib/payments/plans";
import { BITPAY_PLAN_KEYS, isBitpayPlanKey } from "@/lib/payments/plans";

/** BitPay rejects amounts below 5,000 rial (500 toman). */
export const BITPAY_MIN_AMOUNT_RIAL = 5_000;

export type DiscountType = "percent" | "fixed";

export interface DiscountCode {
  id: string;
  code: string;
  description: string | null;
  type: DiscountType;
  /** Percent (1..100) or a fixed amount in toman. */
  value: number;
  /** Null = every plan. */
  planKeys: BitpayPlanKey[] | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxPerUser: number;
  firstPurchaseOnly: boolean;
  isActive: boolean;
  redemptionCount: number;
}

export type DiscountRejection =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "plan_not_eligible"
  | "limit_reached"
  | "already_used"
  | "first_purchase_only";

export const DISCOUNT_REJECTIONS: readonly DiscountRejection[] = [
  "not_found",
  "inactive",
  "not_started",
  "expired",
  "plan_not_eligible",
  "limit_reached",
  "already_used",
  "first_purchase_only",
];

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

/** Uppercase + trim; null when it can never be a valid code. */
export function normalizeDiscountCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export function parsePlanKeys(raw: string | null): BitpayPlanKey[] | null {
  if (!raw) return null;
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter(isBitpayPlanKey);
  return keys.length > 0 && keys.length < BITPAY_PLAN_KEYS.length ? keys : null;
}

export interface DiscountedAmount {
  listAmountRial: number;
  discountAmountRial: number;
  amountRial: number;
}

/**
 * Applies a discount to a plan price. Results are whole toman. A non-zero
 * total below BitPay's minimum is raised to the minimum; only an exact 100%
 * (or a fixed amount covering the full price) makes the order free.
 */
export function applyDiscount(
  listAmountRial: number,
  type: DiscountType,
  value: number,
): DiscountedAmount {
  let discount =
    type === "percent"
      ? Math.floor((listAmountRial * Math.min(100, Math.max(0, value))) / 100)
      : Math.max(0, value) * 10;
  discount = Math.min(listAmountRial, Math.floor(discount / 10) * 10);

  let amount = listAmountRial - discount;
  if (amount > 0 && amount < BITPAY_MIN_AMOUNT_RIAL) {
    amount = Math.min(listAmountRial, BITPAY_MIN_AMOUNT_RIAL);
    discount = listAmountRial - amount;
  }
  return { listAmountRial, discountAmountRial: discount, amountRial: amount };
}

/** Rules that do not depend on a user or a plan. */
export function checkCodeWindow(
  code: DiscountCode,
  now: Date,
): DiscountRejection | null {
  if (!code.isActive) return "inactive";
  if (code.startsAt && code.startsAt.getTime() > now.getTime()) {
    return "not_started";
  }
  if (code.endsAt && code.endsAt.getTime() <= now.getTime()) return "expired";
  return null;
}

export interface DiscountUsageContext {
  now: Date;
  plan: BitpayPlanKey;
  /** Paid/free orders + recent pending checkouts by other users. */
  reservedRedemptions: number;
  /** Null for anonymous previews (per-user rules are checked at checkout). */
  user: {
    redemptions: number;
    hasPurchased: boolean;
  } | null;
}

export function evaluateDiscount(
  code: DiscountCode,
  listAmountRial: number,
  ctx: DiscountUsageContext,
): { ok: true; amount: DiscountedAmount } | { ok: false; reason: DiscountRejection } {
  const windowRejection = checkCodeWindow(code, ctx.now);
  if (windowRejection) return { ok: false, reason: windowRejection };

  if (code.planKeys && !code.planKeys.includes(ctx.plan)) {
    return { ok: false, reason: "plan_not_eligible" };
  }
  if (
    code.maxRedemptions !== null &&
    ctx.reservedRedemptions >= code.maxRedemptions
  ) {
    return { ok: false, reason: "limit_reached" };
  }
  if (ctx.user) {
    if (ctx.user.redemptions >= code.maxPerUser) {
      return { ok: false, reason: "already_used" };
    }
    if (code.firstPurchaseOnly && ctx.user.hasPurchased) {
      return { ok: false, reason: "first_purchase_only" };
    }
  }
  return { ok: true, amount: applyDiscount(listAmountRial, code.type, code.value) };
}

export interface DiscountCodeInput {
  code: string;
  description: string | null;
  type: DiscountType;
  value: number;
  planKeys: BitpayPlanKey[] | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxPerUser: number;
  firstPurchaseOnly: boolean;
}

function optionalDate(raw: unknown): Date | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" && typeof raw !== "number") return "invalid";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

function optionalPositiveInt(raw: unknown): number | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 1_000_000_000 ? n : "invalid";
}

/** Validates the admin "create code" body. Returns an error string on failure. */
export function parseDiscountCodeInput(
  body: Record<string, unknown>,
): { ok: true; input: DiscountCodeInput } | { ok: false; error: string } {
  const code = normalizeDiscountCode(body.code);
  if (!code) {
    return {
      ok: false,
      error: "Code must be 3-32 characters: A-Z, 0-9, '-' or '_'.",
    };
  }

  const type = body.type;
  if (type !== "percent" && type !== "fixed") {
    return { ok: false, error: "Type must be 'percent' or 'fixed'." };
  }
  const value = Number(body.value);
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, error: "Value must be a positive whole number." };
  }
  if (type === "percent" && value > 100) {
    return { ok: false, error: "Percent must be between 1 and 100." };
  }

  let planKeys: BitpayPlanKey[] | null = null;
  if (Array.isArray(body.planKeys) && body.planKeys.length > 0) {
    if (!body.planKeys.every((k) => typeof k === "string" && isBitpayPlanKey(k))) {
      return { ok: false, error: "Unknown plan in planKeys." };
    }
    planKeys = parsePlanKeys((body.planKeys as string[]).join(","));
  }

  const startsAt = optionalDate(body.startsAt);
  const endsAt = optionalDate(body.endsAt);
  if (startsAt === "invalid" || endsAt === "invalid") {
    return { ok: false, error: "Invalid start or end date." };
  }
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, error: "End date must be after the start date." };
  }

  const maxRedemptions = optionalPositiveInt(body.maxRedemptions);
  if (maxRedemptions === "invalid") {
    return { ok: false, error: "Total uses must be a positive whole number." };
  }
  const maxPerUser = optionalPositiveInt(body.maxPerUser) ?? 1;
  if (maxPerUser === "invalid") {
    return { ok: false, error: "Uses per user must be a positive whole number." };
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim().slice(0, 255)
      : null;

  return {
    ok: true,
    input: {
      code,
      description,
      type,
      value,
      planKeys,
      startsAt,
      endsAt,
      maxRedemptions,
      maxPerUser,
      firstPurchaseOnly: body.firstPurchaseOnly === true,
    },
  };
}
