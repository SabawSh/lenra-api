import type { UserId } from "@/types/schema";

import {
  deletePushSubscriptionById,
  listPushSubscriptionsForUser,
} from "@/lib/db/pushSubscriptions";
import type { PushNotificationPayload } from "@/lib/push/types";

import { pushLog } from "./logger";
import { sendWebPush } from "./webPush";

export type PushDeliveryError = {
  subscriptionId: number;
  statusCode?: number;
  vapidMismatch?: boolean;
  expired?: boolean;
};

export type SendToUserResult = {
  sent: number;
  failed: number;
  removed: number;
  subscriptionCount: number;
  errors: PushDeliveryError[];
};

export async function sendPushToUser(
  userId: UserId,
  payload: PushNotificationPayload,
): Promise<SendToUserResult> {
  const subs = await listPushSubscriptionsForUser(userId);
  if (subs.length === 0) {
    return { sent: 0, failed: 0, removed: 0, subscriptionCount: 0, errors: [] };
  }

  pushLog.info("sendPushToUser", {
    userId,
    subscriptionCount: subs.length,
    title: payload.title,
  });

  let sent = 0;
  let failed = 0;
  let removed = 0;
  const errors: PushDeliveryError[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      const result = await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload,
      );
      if (result.ok) {
        sent += 1;
        return;
      }
      failed += 1;
      errors.push({
        subscriptionId: sub.id,
        statusCode: result.statusCode,
        vapidMismatch: result.vapidMismatch,
        expired: result.expired,
      });
      if (result.expired) {
        await deletePushSubscriptionById(sub.id);
        removed += 1;
        pushLog.info("removed expired subscription", {
          userId,
          subscriptionId: sub.id,
        });
      }
    }),
  );

  return { sent, failed, removed, subscriptionCount: subs.length, errors };
}
