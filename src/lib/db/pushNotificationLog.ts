import { pool } from "@/lib/db/connection";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { UserId } from "@/types/schema";
export async function hasNotificationBeenSent(
  userId: UserId,
  notificationKey: string,
): Promise<boolean> {
  type R = RowDataPacket & { c: bigint };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT COUNT(*) AS c
    FROM push_notification_log
    WHERE user_id = ? AND notification_key = ?
    `,
    [userId, notificationKey],
  );
  return rows[0] ? Number(rows[0].c) > 0 : false;
}

/** Returns true if this send is new (dedupe lock acquired). */
export async function tryLogNotificationSent(
  userId: UserId,
  notificationKey: string,
): Promise<boolean> {
  try {
    const [res] = await pool.execute<ResultSetHeader>(
      `
      INSERT INTO push_notification_log (user_id, notification_key)
      VALUES (?, ?)
      `,
      [userId, notificationKey],
    );
    return res.affectedRows > 0;
  } catch {
    return false;
  }
}

/** Remove stale dedupe keys older than 30 days. */
export async function pruneOldNotificationLogs(): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `
    DELETE FROM push_notification_log
    WHERE sent_at < DATE_SUB(NOW(3), INTERVAL 30 DAY)
    `,
  );
  return res.affectedRows;
}
