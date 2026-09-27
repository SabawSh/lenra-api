/**
 * `user_auth_methods` — verified login providers bound to `users.id`.
 *
 * Username lives on `users` and is only a public handle; it is never used here
 * to merge or link accounts (that would allow takeover via guessed handles).
 */
import { randomUUID } from "crypto";
import { pool } from "@/lib/db/connection";
import type { UserId } from "@/types/schema";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

export type AuthProvider = "google" | "phone";

export interface UserAuthMethodRow extends RowDataPacket {
  id: string;
  user_id: UserId;
  provider: AuthProvider;
  provider_account_id: string;
  email: string | null;
  phone: string | null;
  verified_at: Date | null;
  created_at: Date;
}

export type UserAuthMethod = {
  id: string;
  userId: UserId;
  provider: AuthProvider;
  providerAccountId: string;
  email: string | null;
  phone: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
};

function mapRow(row: UserAuthMethodRow): UserAuthMethod {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    email: row.email,
    phone: row.phone,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
}

export async function findAuthMethodByProviderAccount(
  provider: AuthProvider,
  providerAccountId: string,
): Promise<UserAuthMethod | null> {
  const [rows] = await pool.execute<UserAuthMethodRow[]>(
    `
      SELECT id, user_id, provider, provider_account_id, email, phone, verified_at, created_at
      FROM user_auth_methods
      WHERE provider = ? AND provider_account_id = ?
      LIMIT 1
    `,
    [provider, providerAccountId],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function listAuthMethodsForUser(
  userId: UserId,
): Promise<UserAuthMethod[]> {
  const [rows] = await pool.execute<UserAuthMethodRow[]>(
    `
      SELECT id, user_id, provider, provider_account_id, email, phone, verified_at, created_at
      FROM user_auth_methods
      WHERE user_id = ?
      ORDER BY created_at ASC
    `,
    [userId],
  );
  return rows.map(mapRow);
}

export async function countAuthMethodsForUser(userId: UserId): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM user_auth_methods WHERE user_id = ?`,
    [userId],
  );
  return Number(rows[0]?.c ?? 0);
}

export async function insertGoogleAuthMethod(params: {
  userId: UserId;
  googleSub: string;
  email: string | null;
  verifiedAt: Date;
}): Promise<UserAuthMethod> {
  const id = randomUUID();
  await pool.execute<ResultSetHeader>(
    `
      INSERT INTO user_auth_methods (
        id, user_id, provider, provider_account_id, email, phone, verified_at
      )
      VALUES (?, ?, 'google', ?, ?, NULL, ?)
    `,
    [id, params.userId, params.googleSub, params.email, params.verifiedAt],
  );
  const created = await findAuthMethodByProviderAccount("google", params.googleSub);
  if (!created) throw new Error("insertGoogleAuthMethod: row missing after insert");
  return created;
}

export async function insertPhoneAuthMethod(params: {
  userId: UserId;
  phone: string;
  verifiedAt: Date;
}): Promise<UserAuthMethod> {
  const id = randomUUID();
  await pool.execute<ResultSetHeader>(
    `
      INSERT INTO user_auth_methods (
        id, user_id, provider, provider_account_id, email, phone, verified_at
      )
      VALUES (?, ?, 'phone', ?, NULL, ?, ?)
    `,
    [id, params.userId, params.phone, params.phone, params.verifiedAt],
  );
  const created = await findAuthMethodByProviderAccount("phone", params.phone);
  if (!created) throw new Error("insertPhoneAuthMethod: row missing after insert");
  return created;
}

/** Keeps legacy `users` identity columns aligned with auth methods (read paths unchanged). */
export async function syncUserIdentityFromAuthMethods(userId: UserId): Promise<void> {
  const methods = await listAuthMethodsForUser(userId);
  const google = methods.find((m) => m.provider === "google");
  const phone = methods.find((m) => m.provider === "phone");

  await pool.execute<ResultSetHeader>(
    `
      UPDATE users SET
        google_id = ?,
        email = COALESCE(?, email),
        email_verified_at = CASE WHEN ? IS NOT NULL THEN COALESCE(email_verified_at, ?) ELSE email_verified_at END,
        phone = ?,
        phone_verified_at = CASE WHEN ? IS NOT NULL THEN COALESCE(phone_verified_at, ?) ELSE phone_verified_at END
      WHERE id = ?
    `,
    [
      google?.providerAccountId ?? null,
      google?.email ?? null,
      google?.email ?? null,
      google?.verifiedAt ?? null,
      phone?.phone ?? null,
      phone?.phone ?? null,
      phone?.verifiedAt ?? null,
      userId,
    ],
  );
}

export function isAuthMethodDuplicateError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ER_DUP_ENTRY"
  );
}
