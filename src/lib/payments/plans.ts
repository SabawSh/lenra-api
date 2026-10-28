export const BITPAY_PLAN_KEYS = ["monthly", "every6Months", "yearly"] as const;

export type BitpayPlanKey = (typeof BITPAY_PLAN_KEYS)[number];

const DEFAULT_PLAN_AMOUNTS_RIAL: Record<BitpayPlanKey, number> = {
  monthly: 6_990_000,
  every6Months: 34_900_000,
  yearly: 59_900_000,
};

function envInt(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function getPlanAmountRial(plan: BitpayPlanKey): number {
  if (plan === "monthly") {
    return envInt("BITPAY_PLAN_MONTHLY_RIAL") ?? DEFAULT_PLAN_AMOUNTS_RIAL.monthly;
  }
  if (plan === "every6Months") {
    return (
      envInt("BITPAY_PLAN_EVERY6MONTHS_RIAL") ??
      DEFAULT_PLAN_AMOUNTS_RIAL.every6Months
    );
  }
  return envInt("BITPAY_PLAN_YEARLY_RIAL") ?? DEFAULT_PLAN_AMOUNTS_RIAL.yearly;
}

/** Includes bonus months: 6 + 1 free, 12 + 2 free (30 days per bonus month). */
const PLAN_DURATION_DAYS: Record<BitpayPlanKey, number> = {
  monthly: 30,
  every6Months: 210,
  yearly: 425,
};

export function getPlanDurationMs(plan: BitpayPlanKey): number {
  return PLAN_DURATION_DAYS[plan] * 24 * 60 * 60 * 1000;
}

export function isBitpayPlanKey(value: string): value is BitpayPlanKey {
  return (BITPAY_PLAN_KEYS as readonly string[]).includes(value);
}
