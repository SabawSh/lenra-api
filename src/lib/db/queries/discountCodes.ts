import { randomUUID } from "crypto";
import { pool, withTransaction } from "@/lib/db/connection";
import { mysqlErrno } from "@/lib/db/queries/paymentOrders";
import {
  grantDiscountSubscription,
  type DbExecutor,
} from "@/lib/db/queries/subscriptions";
import {
  evaluateDiscount,
  normalizeDiscountCode,
  parsePlanKeys,
  type DiscountCode,
  type DiscountCodeInput,
  type DiscountedAmount,
  type DiscountRejection,
} from "@/lib/payments/discounts";
import { newFactorId } from "@/lib/payments/orderVerification";
import type { BitpayPlanKey } from "@/lib/payments/plans";
import { BITPAY_PLAN_KEYS, getPlanAmountRial } from "@/lib/payments/plans";
import type { UserId } from "@/types/schema";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

/** A pending checkout holds a slot of a capped code for this long. */
const PENDING_RESERVATION_MINUTES = 30;

interface DiscountCodeRow extends RowDataPacket {
  id: string;
  code: string;
  description: string | null;
  discount_type: "percent" | "fixed";
  discount_value: number | string;
  plan_keys: string | null;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  max_redemptions: number | string | null;
  max_per_user: number | string;
  first_purchase_only: number | boolean;
  is_active: number | boolean;
  redemption_count: number | string;
  created_at?: Date | string;
}

const CODE_COLUMNS = `id, code, description, discount_type, discount_value,
  plan_keys, starts_at, ends_at, max_redemptions, max_per_user,
  first_purchase_only, is_active, redemption_count`;

function dateOrNull(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapCode(row: DiscountCodeRow): DiscountCode {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    type: row.discount_type,
    value: Number(row.discount_value),
    planKeys: parsePlanKeys(row.plan_keys),
    startsAt: dateOrNull(row.starts_at),
    endsAt: dateOrNull(row.ends_at),
    maxRedemptions:
      row.max_redemptions === null ? null : Number(row.max_redemptions),
    maxPerUser: Number(row.max_per_user),
    firstPurchaseOnly: Boolean(Number(row.first_purchase_only)),
    isActive: Boolean(Number(row.is_active)),
    redemptionCount: Number(row.redemption_count),
  };
}

async function findCode(
  code: string,
  db: DbExecutor,
  forUpdate = false,
): Promise<DiscountCode | null> {
  const [rows] = await db.query<DiscountCodeRow[]>(
    `SELECT ${CODE_COLUMNS} FROM discount_codes WHERE code = ? LIMIT 1${
      forUpdate ? " FOR UPDATE" : ""
    }`,
    [code],
  );
  return rows[0] ? mapCode(rows[0]) : null;
}

interface CountRow extends RowDataPacket {
  n: number | string;
}

async function usageFor(
  code: DiscountCode,
  userId: UserId | null,
  db: DbExecutor,
) {
  let reserved = code.redemptionCount;
  if (code.maxRedemptions !== null) {
    const [pending] = await db.query<CountRow[]>(
      `SELECT COUNT(DISTINCT user_id) AS n FROM payment_orders
       WHERE discount_code_id = ? AND status = 'pending'
         AND created_at > UTC_TIMESTAMP(3) - INTERVAL ${PENDING_RESERVATION_MINUTES} MINUTE
         ${userId ? "AND user_id <> ?" : ""}`,
      userId ? [code.id, userId] : [code.id],
    );
    reserved += Number(pending[0]?.n ?? 0);
  }
  if (!userId) return { reservedRedemptions: reserved, user: null };

  const [used] = await db.query<CountRow[]>(
    `SELECT COUNT(*) AS n FROM payment_orders
     WHERE discount_code_id = ? AND user_id = ? AND status = 'paid'`,
    [code.id, userId],
  );
  // "First purchase" means the first time real money was paid; gift codes
  // and admin grants do not count.
  const [bought] = await db.query<CountRow[]>(
    `SELECT (
       EXISTS (SELECT 1 FROM payment_orders
               WHERE user_id = ? AND status = 'paid' AND amount_rial > 0)
       OR EXISTS (SELECT 1 FROM user_subscriptions
                  WHERE user_id = ? AND bitpay_trans_id IS NOT NULL)
     ) AS n`,
    [userId, userId],
  );
  return {
    reservedRedemptions: reserved,
    user: {
      redemptions: Number(used[0]?.n ?? 0),
      hasPurchased: Number(bought[0]?.n ?? 0) > 0,
    },
  };
}

export type CodeEvaluation =
  | { ok: true; code: DiscountCode; amount: DiscountedAmount }
  | { ok: false; reason: DiscountRejection };

/** Full check of one code for one plan (and user, when signed in). */
export async function evaluateDiscountCode(params: {
  rawCode: string;
  plan: BitpayPlanKey;
  userId: UserId | null;
  db?: DbExecutor;
  forUpdate?: boolean;
}): Promise<CodeEvaluation> {
  const db = params.db ?? pool;
  const normalized = normalizeDiscountCode(params.rawCode);
  if (!normalized) return { ok: false, reason: "not_found" };
  const code = await findCode(normalized, db, params.forUpdate);
  if (!code) return { ok: false, reason: "not_found" };

  const usage = await usageFor(code, params.userId, db);
  const result = evaluateDiscount(code, getPlanAmountRial(params.plan), {
    now: new Date(),
    plan: params.plan,
    ...usage,
  });
  return result.ok ? { ok: true, code, amount: result.amount } : result;
}

export type DiscountPreview =
  | {
      ok: true;
      code: string;
      plans: Record<
        BitpayPlanKey,
        | ({ eligible: true } & DiscountedAmount)
        | { eligible: false; reason: DiscountRejection }
      >;
    }
  | { ok: false; reason: DiscountRejection };

/** What the code does to every plan, for the pricing page. */
export async function previewDiscountCode(
  rawCode: string,
  userId: UserId | null,
): Promise<DiscountPreview> {
  const normalized = normalizeDiscountCode(rawCode);
  if (!normalized) return { ok: false, reason: "not_found" };
  const code = await findCode(normalized, pool);
  if (!code) return { ok: false, reason: "not_found" };

  const usage = await usageFor(code, userId, pool);
  const now = new Date();
  const plans = {} as Extract<DiscountPreview, { ok: true }>["plans"];
  let firstReason: DiscountRejection | null = null;
  for (const plan of BITPAY_PLAN_KEYS) {
    const r = evaluateDiscount(code, getPlanAmountRial(plan), {
      now,
      plan,
      ...usage,
    });
    if (r.ok) {
      plans[plan] = { eligible: true, ...r.amount };
    } else {
      plans[plan] = { eligible: false, reason: r.reason };
      firstReason ??= r.reason;
    }
  }
  const anyEligible = Object.values(plans).some((p) => p.eligible);
  if (!anyEligible) return { ok: false, reason: firstReason ?? "not_found" };
  return { ok: true, code: code.code, plans };
}

export type FreeRedemptionResult =
  | { ok: true; expiresAt: Date }
  | { ok: false; reason: DiscountRejection | "not_free" };

/**
 * Redeems a code that makes the plan free: no gateway. The code row is locked
 * so a capped code cannot be redeemed past its limit by parallel requests.
 */
export async function redeemFreeDiscount(params: {
  rawCode: string;
  plan: BitpayPlanKey;
  userId: UserId;
}): Promise<FreeRedemptionResult> {
  return withTransaction(async (conn) => {
    const evaluation = await evaluateDiscountCode({
      rawCode: params.rawCode,
      plan: params.plan,
      userId: params.userId,
      db: conn,
      forUpdate: true,
    });
    if (!evaluation.ok) return evaluation;
    if (evaluation.amount.amountRial !== 0) {
      return { ok: false, reason: "not_free" } as const;
    }

    const { subscriptionId, expiresAt } = await grantDiscountSubscription(
      { userId: params.userId, planKey: params.plan },
      conn,
    );
    await conn.query<ResultSetHeader>(
      `INSERT INTO payment_orders (
        id, user_id, plan_key, provider, status,
        list_amount_rial, discount_amount_rial, amount_rial, factor_id,
        discount_code_id, discount_code, subscription_id, paid_at
      ) VALUES (?, ?, ?, 'free', 'paid', ?, ?, 0, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [
        randomUUID(),
        params.userId,
        params.plan,
        evaluation.amount.listAmountRial,
        evaluation.amount.discountAmountRial,
        newFactorId(),
        evaluation.code.id,
        evaluation.code.code,
        subscriptionId,
      ],
    );
    await conn.query<ResultSetHeader>(
      `UPDATE discount_codes SET redemption_count = redemption_count + 1
       WHERE id = ?`,
      [evaluation.code.id],
    );
    return { ok: true, expiresAt } as const;
  });
}

/* ---------------------------------------------------------------- admin */

export interface AdminDiscountCode extends DiscountCode {
  createdAt: Date | null;
  stats: {
    paidOrders: number;
    freeOrders: number;
    pendingOrders: number;
    revenueRial: number;
    discountGivenRial: number;
  };
}

interface StatsRow extends RowDataPacket {
  discount_code_id: string;
  paid_orders: number | string;
  free_orders: number | string;
  pending_orders: number | string;
  revenue_rial: number | string | null;
  discount_rial: number | string | null;
}

export async function listDiscountCodesForAdmin(): Promise<AdminDiscountCode[]> {
  const [rows] = await pool.query<DiscountCodeRow[]>(
    `SELECT ${CODE_COLUMNS}, created_at FROM discount_codes
     ORDER BY created_at DESC LIMIT 500`,
  );
  if (rows.length === 0) return [];

  const [stats] = await pool.query<StatsRow[]>(
    `SELECT discount_code_id,
       SUM(status = 'paid' AND provider = 'bitpay') AS paid_orders,
       SUM(status = 'paid' AND provider = 'free') AS free_orders,
       SUM(status = 'pending') AS pending_orders,
       SUM(CASE WHEN status = 'paid' THEN amount_rial ELSE 0 END) AS revenue_rial,
       SUM(CASE WHEN status = 'paid' THEN discount_amount_rial ELSE 0 END) AS discount_rial
     FROM payment_orders
     WHERE discount_code_id IS NOT NULL
     GROUP BY discount_code_id`,
  );
  const byId = new Map(stats.map((s) => [s.discount_code_id, s]));

  return rows.map((row) => {
    const s = byId.get(row.id);
    return {
      ...mapCode(row),
      createdAt: dateOrNull(row.created_at),
      stats: {
        paidOrders: Number(s?.paid_orders ?? 0),
        freeOrders: Number(s?.free_orders ?? 0),
        pendingOrders: Number(s?.pending_orders ?? 0),
        revenueRial: Number(s?.revenue_rial ?? 0),
        discountGivenRial: Number(s?.discount_rial ?? 0),
      },
    };
  });
}

export async function createDiscountCode(
  input: DiscountCodeInput,
  createdBy: UserId,
): Promise<{ ok: true; id: string } | { ok: false; error: "duplicate" }> {
  const id = randomUUID();
  try {
    await pool.query<ResultSetHeader>(
      `INSERT INTO discount_codes (
        id, code, description, discount_type, discount_value, plan_keys,
        starts_at, ends_at, max_redemptions, max_per_user,
        first_purchase_only, is_active, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id,
        input.code,
        input.description,
        input.type,
        input.value,
        input.planKeys ? input.planKeys.join(",") : null,
        input.startsAt,
        input.endsAt,
        input.maxRedemptions,
        input.maxPerUser,
        input.firstPurchaseOnly ? 1 : 0,
        createdBy,
      ],
    );
    return { ok: true, id };
  } catch (error) {
    if (mysqlErrno(error) === 1062) return { ok: false, error: "duplicate" };
    throw error;
  }
}

/** Only fields that are safe to change after a code has been shared. */
export interface DiscountCodePatch {
  isActive?: boolean;
  description?: string | null;
  endsAt?: Date | null;
  maxRedemptions?: number | null;
}

export async function updateDiscountCode(
  id: string,
  patch: DiscountCodePatch,
): Promise<boolean> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.isActive !== undefined) {
    sets.push("is_active = ?");
    values.push(patch.isActive ? 1 : 0);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    values.push(patch.description);
  }
  if (patch.endsAt !== undefined) {
    sets.push("ends_at = ?");
    values.push(patch.endsAt);
  }
  if (patch.maxRedemptions !== undefined) {
    sets.push("max_redemptions = ?");
    values.push(patch.maxRedemptions);
  }
  if (sets.length === 0) return false;
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE discount_codes SET ${sets.join(", ")} WHERE id = ?`,
    [...values, id],
  );
  return res.affectedRows > 0;
}
