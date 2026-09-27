import { randomUUID } from "crypto";
import { pool } from "@/lib/db/connection";
import type { BitpayPlanKey } from "@/lib/payments/plans";
import { getPlanDurationMs } from "@/lib/payments/plans";
import type { UserId } from "@/types/schema";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

interface SubscriptionExpiryRow extends RowDataPacket {
  expires_at: Date | string;
}

function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date value");
  }
  return parsed;
}

interface ExistingTransRow extends RowDataPacket {
  id: string;
}

function isMissingSourceColumnError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const maybe = error as {
    errno?: unknown;
    sqlMessage?: unknown;
  };
  return (
    maybe.errno === 1054 &&
    typeof maybe.sqlMessage === "string" &&
    maybe.sqlMessage.includes("Unknown column 'source'")
  );
}

export async function getActiveSubscriptionExpiresAt(
  userId: UserId,
): Promise<Date | null> {
  const [rows] = await pool.query<SubscriptionExpiryRow[]>(
    `SELECT expires_at
     FROM user_subscriptions
     WHERE user_id = ?
       AND status = 'active'
       AND expires_at > UTC_TIMESTAMP(3)
     ORDER BY expires_at DESC
     LIMIT 1`,
    [userId],
  );
  return rows[0]?.expires_at ? toDate(rows[0].expires_at) : null;
}

export async function activateUserSubscription(params: {
  userId: UserId;
  planKey: BitpayPlanKey;
  idTrans: number;
  getId: number;
}): Promise<Date> {
  const [existingRows] = await pool.query<ExistingTransRow[]>(
    `SELECT id FROM user_subscriptions WHERE bitpay_trans_id = ? LIMIT 1`,
    [params.idTrans],
  );
  if (existingRows[0]) {
    const [row] = await pool.query<SubscriptionExpiryRow[]>(
      `SELECT expires_at FROM user_subscriptions WHERE id = ? LIMIT 1`,
      [existingRows[0].id],
    );
    return row[0]?.expires_at ? toDate(row[0].expires_at) : new Date();
  }

  const currentExpiry = await getActiveSubscriptionExpiresAt(params.userId);
  const now = new Date();
  const base =
    currentExpiry && toDate(currentExpiry).getTime() > now.getTime()
      ? toDate(currentExpiry)
      : now;
  const expiresAt = new Date(base.getTime() + getPlanDurationMs(params.planKey));

  await pool.query<ResultSetHeader>(
    `INSERT INTO user_subscriptions (
      id, user_id, plan_key, status, starts_at, expires_at,
      bitpay_trans_id, bitpay_get_id
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
    [
      randomUUID(),
      params.userId,
      params.planKey,
      base,
      expiresAt,
      params.idTrans,
      params.getId,
    ],
  );

  return expiresAt;
}

/**
 * Admin grant: extend the user's active expiry (if any) and activate the
 * chosen plan for the duration.
 *
 * Inserts a normal `user_subscriptions` row, but marks it as `source='admin'`
 * so we can distinguish it from BitPay-created rows.
 */
export async function adminGrantUserSubscription(params: {
  userId: UserId;
  planKey: BitpayPlanKey;
}): Promise<Date> {
  const currentExpiry = await getActiveSubscriptionExpiresAt(params.userId);
  const now = new Date();
  const base =
    currentExpiry && toDate(currentExpiry).getTime() > now.getTime()
      ? toDate(currentExpiry)
      : now;
  const expiresAt = new Date(base.getTime() + getPlanDurationMs(params.planKey));

  const id = randomUUID();
  try {
    await pool.query<ResultSetHeader>(
      `
      INSERT INTO user_subscriptions (
        id, user_id, plan_key, status, starts_at, expires_at,
        source
      ) VALUES (?, ?, ?, 'active', ?, ?, 'admin')
      `,
      [id, params.userId, params.planKey, base, expiresAt],
    );
  } catch (error) {
    if (!isMissingSourceColumnError(error)) {
      throw error;
    }

    // Backward compatibility while the DB migration has not been applied yet.
    await pool.query<ResultSetHeader>(
      `
      INSERT INTO user_subscriptions (
        id, user_id, plan_key, status, starts_at, expires_at
      ) VALUES (?, ?, ?, 'active', ?, ?)
      `,
      [id, params.userId, params.planKey, base, expiresAt],
    );
  }

  return expiresAt;
}
