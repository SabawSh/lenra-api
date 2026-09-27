import { pool } from "@/lib/db/connection";
import type { RowDataPacket } from "mysql2/promise";

import type { UserId } from "@/types/schema";
export type UserReminderPushCandidate = {
  userId: UserId;
  dueCount: number;
  overdueCount: number;
  nextDueAt: Date | null;
  streakCurrent: number;
};

function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export { localDateKey };

/**
 * Users with at least one reminder due today (local calendar day)
 * who have push enabled and review reminders on.
 */
export async function listUsersForReviewReminderPush(): Promise<
  UserReminderPushCandidate[]
> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  type R = RowDataPacket & {
    user_id: UserId;
    due_count: bigint;
    overdue_count: bigint;
    next_due_at: Date | null;
    streak_current: number;
  };

  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      u.id AS user_id,
      COUNT(ur.id) AS due_count,
      SUM(CASE WHEN ur.due_at < ? THEN 1 ELSE 0 END) AS overdue_count,
      MIN(ur.due_at) AS next_due_at,
      u.learning_streak_current AS streak_current
    FROM users u
    INNER JOIN user_notification_settings uns ON uns.user_id = u.id
    INNER JOIN user_reminders ur ON ur.user_id = u.id
    INNER JOIN push_subscriptions ps ON ps.user_id = u.id
    WHERE uns.push_enabled = 1
      AND uns.review_reminders = 1
      AND ur.due_at >= ? AND ur.due_at < ?
    GROUP BY u.id, u.learning_streak_current
    HAVING due_count > 0
    `,
    [now, start, end],
  );

  return rows.map((r) => ({
    userId: r.user_id,
    dueCount: Number(r.due_count),
    overdueCount: Number(r.overdue_count),
    nextDueAt: r.next_due_at,
    streakCurrent: Number(r.streak_current),
  }));
}

/**
 * Users with an active streak who have not logged learning today (UTC day key on user).
 */
export async function listUsersForStreakReminderPush(): Promise<
  Pick<UserReminderPushCandidate, "userId" | "streakCurrent">[]
> {
  const todayKey = localDateKey();

  type R = RowDataPacket & {
    user_id: UserId;
    streak_current: number;
  };

  const [rows] = await pool.execute<R[]>(
    `
    SELECT u.id AS user_id, u.learning_streak_current AS streak_current
    FROM users u
    INNER JOIN user_notification_settings uns ON uns.user_id = u.id
    INNER JOIN push_subscriptions ps ON ps.user_id = u.id
    WHERE uns.push_enabled = 1
      AND uns.streak_reminders = 1
      AND u.learning_streak_current > 0
      AND (u.last_learning_streak_day_key IS NULL OR u.last_learning_streak_day_key <> ?)
    GROUP BY u.id, u.learning_streak_current
    `,
    [todayKey],
  );

  return rows.map((r) => ({
    userId: r.user_id,
    streakCurrent: Number(r.streak_current),
  }));
}
