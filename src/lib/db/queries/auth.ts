/**
 * MySQL accessors for phone OTP / verification rows (`phone_verifications`).
 */
import { pool } from "@/lib/db/connection";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

export interface PhoneVerificationRow extends RowDataPacket {
  id: number;
  phone: string;
  code_hash: string;
  expires_at: Date;
  attempts: number;
  consumed_at: Date | null;
  created_at: Date;
}

const SELECT_COLS = `
  id,
  phone,
  code_hash,
  expires_at,
  attempts,
  consumed_at,
  created_at
`.replace(/\s+/g, " ");

/** Most recent unconsumed row for this phone (same semantics as Prisma `findFirst` + `orderBy: createdAt desc`). */
export async function findLatestUnconsumedPhoneVerification(
  phone: string,
): Promise<PhoneVerificationRow | null> {
  const [rows] = await pool.execute<PhoneVerificationRow[]>(
    `
      SELECT ${SELECT_COLS}
      FROM phone_verifications
      WHERE phone = ? AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [phone],
  );
  return rows[0] ?? null;
}

/** Marks all unconsumed rows for the phone as consumed (invalidate old codes). */
export async function consumeAllUnconsumedPhoneVerifications(
  phone: string,
  consumedAt: Date,
): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `
      UPDATE phone_verifications
      SET consumed_at = ?
      WHERE phone = ? AND consumed_at IS NULL
    `,
    [consumedAt, phone],
  );
}

export async function insertPhoneVerification(params: {
  phone: string;
  codeHash: string;
  expiresAt: Date;
}): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `
      INSERT INTO phone_verifications (phone, code_hash, expires_at)
      VALUES (?, ?, ?)
    `,
    [params.phone, params.codeHash, params.expiresAt],
  );
  return res.insertId;
}

export async function markPhoneVerificationConsumed(
  id: number,
  consumedAt: Date,
): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `UPDATE phone_verifications SET consumed_at = ? WHERE id = ?`,
    [consumedAt, id],
  );
}

export async function incrementPhoneVerificationAttempts(
  id: number,
): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ?`,
    [id],
  );
}
