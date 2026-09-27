
import type { PushNotificationPayload } from "@/lib/push/types";
import type { UserReminderPushCandidate } from "@/lib/db/queries/pushReminders";
import { localDateKey } from "@/lib/db/queries/pushReminders";

import type { UserId } from "@/types/schema";
export function reviewDigestNotificationKey(userId: UserId, dateKey?: string) {
  return `review-digest:${userId}:${dateKey ?? localDateKey()}`;
}

export function streakNotificationKey(userId: UserId, dateKey?: string) {
  return `streak-nudge:${userId}:${dateKey ?? localDateKey()}`;
}

export function buildReviewDigestPayload(
  candidate: UserReminderPushCandidate,
  locale: "en" | "fa" = "en",
): PushNotificationPayload {
  const { dueCount, overdueCount } = candidate;
  const deepLink = "/dashboard";

  if (locale === "fa") {
    if (dueCount === 1) {
      return {
        title: "لنرا",
        body: overdueCount > 0 ? "یک مرور آماده است" : "مرور امروز شما آماده است",
        deepLink,
        tag: "lenra-review-1",
      };
    }
    return {
      title: "لنرا",
      body: `${dueCount} مرور در انتظار شماست`,
      deepLink,
      tag: `lenra-review-${dueCount}`,
    };
  }

  if (dueCount === 1) {
    return {
      title: "Lenra",
      body:
        overdueCount > 0
          ? "Your review is ready"
          : "You have a review ready for today",
      deepLink,
      tag: "lenra-review-1",
    };
  }

  return {
    title: "Lenra",
    body: `${dueCount} reviews are waiting`,
    deepLink,
    tag: `lenra-review-${dueCount}`,
  };
}

export function buildStreakNudgePayload(
  streak: number,
  locale: "en" | "fa" = "en",
): PushNotificationPayload {
  const deepLink = "/dashboard";

  if (locale === "fa") {
    return {
      title: "لنرا",
      body: `روند ${streak} روزه‌ات را حفظ کن — امروز یک مرور کوتاه کافی است`,
      deepLink,
      tag: "lenra-streak",
    };
  }

  return {
    title: "Lenra",
    body: `Keep your ${streak}-day streak alive — a quick review today counts`,
    deepLink,
    tag: "lenra-streak",
  };
}
