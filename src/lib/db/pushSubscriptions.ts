import { pool } from "@/lib/db/connection";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { UserId } from "@/types/schema";
export type PushSubscriptionRow = {
  id: number;
  userId: UserId;
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date | null;
};

type SubRow = RowDataPacket & {
  id: number;
  user_id: UserId;
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: string | null;
  user_agent: string | null;
  created_at: Date;
  updated_at: Date;
  last_seen_at: Date | null;
};

function mapRow(r: SubRow): PushSubscriptionRow {
  return {
    id: Number(r.id),
    userId: r.user_id,
    endpoint: String(r.endpoint),
    p256dh: String(r.p256dh),
    auth: String(r.auth),
    platform: r.platform != null ? String(r.platform) : null,
    userAgent: r.user_agent != null ? String(r.user_agent) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastSeenAt: r.last_seen_at,
  };
}

export async function upsertPushSubscription(input: {
  userId: UserId;
  endpoint: string;
  p256dh: string;
  auth: string;
  platform?: string | null;
  userAgent?: string | null;
}): Promise<PushSubscriptionRow> {
  await pool.execute<ResultSetHeader>(
    `
    INSERT INTO push_subscriptions (
      user_id, endpoint, p256dh, auth, platform, user_agent, last_seen_at
    )
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE
      user_id = VALUES(user_id),
      p256dh = VALUES(p256dh),
      auth = VALUES(auth),
      platform = COALESCE(VALUES(platform), platform),
      user_agent = COALESCE(VALUES(user_agent), user_agent),
      last_seen_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    `,
    [
      input.userId,
      input.endpoint,
      input.p256dh,
      input.auth,
      input.platform ?? null,
      input.userAgent ?? null,
    ],
  );

  const [rows] = await pool.execute<SubRow[]>(
    `SELECT * FROM push_subscriptions WHERE endpoint = ? LIMIT 1`,
    [input.endpoint],
  );
  const r = rows[0];
  if (!r) throw new Error("upsertPushSubscription: row missing");
  return mapRow(r);
}

export async function deletePushSubscriptionByEndpoint(
  endpoint: string,
  userId?: UserId,
): Promise<boolean> {
  const sql = userId
    ? `DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`
    : `DELETE FROM push_subscriptions WHERE endpoint = ?`;
  const params = userId ? [endpoint, userId] : [endpoint];
  const [res] = await pool.execute<ResultSetHeader>(sql, params);
  return res.affectedRows > 0;
}

export async function deletePushSubscriptionById(id: number): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `DELETE FROM push_subscriptions WHERE id = ?`,
    [id],
  );
}

export async function countPushSubscriptionsForUser(
  userId: UserId,
): Promise<number> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?`,
    [userId],
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

export async function listPushSubscriptionsForUser(
  userId: UserId,
): Promise<PushSubscriptionRow[]> {
  const [rows] = await pool.execute<SubRow[]>(
    `SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map(mapRow);
}

export async function touchPushSubscription(endpoint: string): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `
    UPDATE push_subscriptions
    SET last_seen_at = CURRENT_TIMESTAMP(3)
    WHERE endpoint = ?
    `,
    [endpoint],
  );
}
