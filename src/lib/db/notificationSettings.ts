import { pool } from "@/lib/db/connection";
import type { NotificationSettings } from "@/lib/push/types";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { UserId } from "@/types/schema";
type SettingsRow = RowDataPacket & {
  user_id: UserId;
  push_enabled: number;
  review_reminders: number;
  streak_reminders: number;
  marketing: number;
};

function rowToSettings(r: SettingsRow): NotificationSettings {
  return {
    pushEnabled: Boolean(r.push_enabled),
    reviewReminders: Boolean(r.review_reminders),
    streakReminders: Boolean(r.streak_reminders),
    marketing: Boolean(r.marketing),
  };
}

const DEFAULT_SETTINGS: NotificationSettings = {
  pushEnabled: false,
  reviewReminders: true,
  streakReminders: false,
  marketing: false,
};

export async function getNotificationSettings(
  userId: UserId,
): Promise<NotificationSettings> {
  const [rows] = await pool.execute<SettingsRow[]>(
    `
    SELECT user_id, push_enabled, review_reminders, streak_reminders, marketing
    FROM user_notification_settings
    WHERE user_id = ?
  `,
    [userId],
  );
  const r = rows[0];
  return r ? rowToSettings(r) : { ...DEFAULT_SETTINGS };
}

export async function upsertNotificationSettings(
  userId: UserId,
  patch: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  const current = await getNotificationSettings(userId);
  const next: NotificationSettings = {
    pushEnabled: patch.pushEnabled ?? current.pushEnabled,
    reviewReminders: patch.reviewReminders ?? current.reviewReminders,
    streakReminders: patch.streakReminders ?? current.streakReminders,
    marketing: patch.marketing ?? current.marketing,
  };

  await pool.execute<ResultSetHeader>(
    `
    INSERT INTO user_notification_settings (
      user_id, push_enabled, review_reminders, streak_reminders, marketing
    )
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      push_enabled = VALUES(push_enabled),
      review_reminders = VALUES(review_reminders),
      streak_reminders = VALUES(streak_reminders),
      marketing = VALUES(marketing),
      updated_at = CURRENT_TIMESTAMP(3)
    `,
    [
      userId,
      next.pushEnabled ? 1 : 0,
      next.reviewReminders ? 1 : 0,
      next.streakReminders ? 1 : 0,
      next.marketing ? 1 : 0,
    ],
  );

  return next;
}

export async function setPushEnabled(
  userId: UserId,
  enabled: boolean,
): Promise<NotificationSettings> {
  return upsertNotificationSettings(userId, { pushEnabled: enabled });
}
