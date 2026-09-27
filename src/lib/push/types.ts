/** Web Push notification payload (service worker + server). */

export type PushNotificationPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  deepLink?: string;
  tag?: string;
};

export type PushSubscriptionKeys = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushSubscribeBody = PushSubscriptionKeys & {
  platform?: string;
};

export type NotificationSettings = {
  pushEnabled: boolean;
  reviewReminders: boolean;
  streakReminders: boolean;
  marketing: boolean;
};

export type NotificationSettingsUpdate = Partial<NotificationSettings>;

export type ReminderDigestKind = "due_today" | "due_soon" | "streak";
