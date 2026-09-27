import type { UserId } from "@/types/schema";
/** Single-day reads for `user_daily_xp` / `user_daily_learning_time`. */
import { pool } from "@/lib/db/connection";
import type { RowDataPacket } from "mysql2/promise";

export async function fetchDailyXpForDayKey(
  userId: UserId,
  dayKey: string,
): Promise<number> {
  type R = RowDataPacket & { xp: number };
  const [rows] = await pool.execute<R[]>(
    `SELECT xp FROM user_daily_xp WHERE user_id = ? AND day_key = ? LIMIT 1`,
    [userId, dayKey],
  );
  const r = rows[0];
  return r ? Number(r.xp) : 0;
}

export async function fetchDailyLearningMsForDayKey(
  userId: UserId,
  dayKey: string,
): Promise<number> {
  type R = RowDataPacket & { learning_time_ms: number };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT learning_time_ms
    FROM user_daily_learning_time
    WHERE user_id = ? AND day_key = ?
    LIMIT 1
    `,
    [userId, dayKey],
  );
  const r = rows[0];
  return r ? Number(r.learning_time_ms) : 0;
}
