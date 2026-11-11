import { randomUUID } from "crypto";
import { pool, withTransaction } from "@/lib/db/connection";
import { activateUserSubscription } from "@/lib/db/queries/subscriptions";
import type { BitpayPlanKey } from "@/lib/payments/plans";
import { isBitpayPlanKey } from "@/lib/payments/plans";
import { newFactorId } from "@/lib/payments/orderVerification";
import type { UserId } from "@/types/schema";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type PaymentOrderStatus = "pending" | "paid" | "failed";

export interface PaymentOrder {
  id: string;
  userId: UserId;
  planKey: BitpayPlanKey;
  provider: "bitpay" | "free";
  status: PaymentOrderStatus;
  listAmountRial: number;
  discountAmountRial: number;
  amountRial: number;
  factorId: number;
  bitpayGetId: number | null;
  bitpayTransId: number | null;
  discountCodeId: string | null;
}

interface PaymentOrderRow extends RowDataPacket {
  id: string;
  user_id: string;
  plan_key: string;
  provider: "bitpay" | "free";
  status: PaymentOrderStatus;
  list_amount_rial: number | string;
  discount_amount_rial: number | string;
  amount_rial: number | string;
  factor_id: number | string;
  bitpay_get_id: number | string | null;
  bitpay_trans_id: number | string | null;
  discount_code_id: string | null;
}

const ORDER_COLUMNS = `id, user_id, plan_key, provider, status,
  list_amount_rial, discount_amount_rial, amount_rial, factor_id,
  bitpay_get_id, bitpay_trans_id, discount_code_id`;

function num(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function numOrNull(value: number | string | null): number | null {
  return value === null ? null : num(value);
}

function mapOrder(row: PaymentOrderRow): PaymentOrder | null {
  if (!isBitpayPlanKey(row.plan_key)) return null;
  return {
    id: row.id,
    userId: row.user_id as UserId,
    planKey: row.plan_key,
    provider: row.provider,
    status: row.status,
    listAmountRial: num(row.list_amount_rial),
    discountAmountRial: num(row.discount_amount_rial),
    amountRial: num(row.amount_rial),
    factorId: num(row.factor_id),
    bitpayGetId: numOrNull(row.bitpay_get_id),
    bitpayTransId: numOrNull(row.bitpay_trans_id),
    discountCodeId: row.discount_code_id ?? null,
  };
}

export function mysqlErrno(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const errno = (error as { errno?: unknown }).errno;
  return typeof errno === "number" ? errno : null;
}

/**
 * ER_NO_SUCH_TABLE / ER_BAD_FIELD_ERROR: the payment_orders or discount_codes
 * migration has not been applied yet.
 */
export function isMissingOrdersTableError(error: unknown): boolean {
  const errno = mysqlErrno(error);
  return errno === 1146 || errno === 1054;
}

const ER_DUP_ENTRY = 1062;

export async function createPendingBitpayOrder(params: {
  userId: UserId;
  planKey: BitpayPlanKey;
  listAmountRial: number;
  discountAmountRial?: number;
  amountRial: number;
  discount?: { codeId: string; code: string } | null;
}): Promise<PaymentOrder> {
  const id = randomUUID();
  const discount = params.discountAmountRial ?? 0;
  const codeId = params.discount?.codeId ?? null;

  for (let attempt = 0; ; attempt++) {
    const factorId = newFactorId();
    try {
      await pool.query<ResultSetHeader>(
        `INSERT INTO payment_orders (
          id, user_id, plan_key, provider, status,
          list_amount_rial, discount_amount_rial, amount_rial, factor_id,
          discount_code_id, discount_code
        ) VALUES (?, ?, ?, 'bitpay', 'pending', ?, ?, ?, ?, ?, ?)`,
        [
          id,
          params.userId,
          params.planKey,
          params.listAmountRial,
          discount,
          params.amountRial,
          factorId,
          codeId,
          params.discount?.code ?? null,
        ],
      );
      return {
        id,
        userId: params.userId,
        planKey: params.planKey,
        provider: "bitpay",
        status: "pending",
        listAmountRial: params.listAmountRial,
        discountAmountRial: discount,
        amountRial: params.amountRial,
        factorId,
        bitpayGetId: null,
        bitpayTransId: null,
        discountCodeId: codeId,
      };
    } catch (error) {
      // Two checkouts in the same millisecond with the same random suffix.
      if (mysqlErrno(error) === ER_DUP_ENTRY && attempt < 3) continue;
      throw error;
    }
  }
}

export async function setOrderGatewayId(
  orderId: string,
  getId: number,
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `UPDATE payment_orders SET bitpay_get_id = ?
     WHERE id = ? AND status = 'pending'`,
    [getId, orderId],
  );
}

export async function markOrderFailed(
  orderId: string,
  bitpayStatus: number | null,
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `UPDATE payment_orders SET status = 'failed', bitpay_status = ?
     WHERE id = ? AND status = 'pending'`,
    [bitpayStatus, orderId],
  );
}

export async function getPaymentOrder(
  orderId: string,
): Promise<PaymentOrder | null> {
  const [rows] = await pool.query<PaymentOrderRow[]>(
    `SELECT ${ORDER_COLUMNS} FROM payment_orders WHERE id = ? LIMIT 1`,
    [orderId],
  );
  return rows[0] ? mapOrder(rows[0]) : null;
}

export type CompleteOrderResult =
  | { ok: true; expiresAt: Date; alreadyPaid: boolean }
  | { ok: false; reason: "not_found" | "trans_mismatch" | "trans_reused" };

/**
 * Marks a verified BitPay order paid and activates its subscription in one
 * transaction. The order row is locked, so a double callback cannot grant
 * twice; a repeat with the same trans id is reported as already paid.
 * A trans id that already paid for anything else is rejected.
 */
export async function completeBitpayOrder(params: {
  orderId: string;
  idTrans: number;
  getId: number;
  bitpayStatus: number;
}): Promise<CompleteOrderResult> {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query<PaymentOrderRow[]>(
      `SELECT ${ORDER_COLUMNS} FROM payment_orders WHERE id = ? FOR UPDATE`,
      [params.orderId],
    );
    const order = rows[0] ? mapOrder(rows[0]) : null;
    if (!order) return { ok: false, reason: "not_found" } as const;

    if (order.status === "paid") {
      if (order.bitpayTransId !== params.idTrans) {
        return { ok: false, reason: "trans_mismatch" } as const;
      }
      const [subRows] = await conn.query<
        (RowDataPacket & { expires_at: Date | string })[]
      >(
        `SELECT expires_at FROM user_subscriptions WHERE bitpay_trans_id = ? LIMIT 1`,
        [params.idTrans],
      );
      const raw = subRows[0]?.expires_at;
      return {
        ok: true,
        alreadyPaid: true,
        expiresAt: raw ? new Date(raw) : new Date(),
      } as const;
    }

    const [reused] = await conn.query<RowDataPacket[]>(
      `SELECT 1 FROM user_subscriptions WHERE bitpay_trans_id = ?
       UNION ALL
       SELECT 1 FROM payment_orders WHERE bitpay_trans_id = ? AND id <> ?
       LIMIT 1`,
      [params.idTrans, params.idTrans, order.id],
    );
    if (reused.length > 0) {
      return { ok: false, reason: "trans_reused" } as const;
    }

    // A failed order can still be completed: BitPay may report success on a
    // later verify (e.g. the first verify timed out on our side).
    const { subscriptionId, expiresAt } = await activateUserSubscription(
      {
        userId: order.userId,
        planKey: order.planKey,
        idTrans: params.idTrans,
        getId: params.getId,
      },
      conn,
    );

    await conn.query<ResultSetHeader>(
      `UPDATE payment_orders
       SET status = 'paid', bitpay_trans_id = ?, bitpay_status = ?,
           subscription_id = ?, paid_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [params.idTrans, params.bitpayStatus, subscriptionId, order.id],
    );

    if (order.discountCodeId) {
      // The user has paid, so the redemption always counts (it may overshoot
      // a total cap by the few checkouts that were already in flight).
      await conn.query<ResultSetHeader>(
        `UPDATE discount_codes SET redemption_count = redemption_count + 1
         WHERE id = ?`,
        [order.discountCodeId],
      );
    }

    return { ok: true, alreadyPaid: false, expiresAt } as const;
  });
}
