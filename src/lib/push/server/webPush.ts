
import type { PushNotificationPayload } from "@/lib/push/types";
import webpush from "web-push";

import { getVapidConfig } from "./vapid";
import { pushLog } from "./logger";

let configured = false;

function ensureVapid() {
  if (configured) return;
  const cfg = getVapidConfig();
  if (!cfg) {
    throw new Error("VAPID keys are not configured");
  }
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  configured = true;
}

export type PushSendTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushSendResult =
  | { ok: true }
  | {
      ok: false;
      statusCode?: number;
      expired: boolean;
      vapidMismatch?: boolean;
      body?: string;
    };

export async function sendWebPush(
  target: PushSendTarget,
  payload: PushNotificationPayload,
): Promise<PushSendResult> {
  ensureVapid();

  const endpointShort = target.endpoint.slice(0, 72);
  pushLog.info("sending push", { endpoint: endpointShort });

  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 },
    );
    pushLog.info("push sent", { endpoint: endpointShort });
    return { ok: true };
  } catch (e: unknown) {
    const err = e as {
      statusCode?: number;
      body?: string;
      message?: string;
    };
    const statusCode = err.statusCode;
    const vapidMismatch = statusCode === 401;
    const expired =
      statusCode === 404 || statusCode === 410 || (statusCode === 403 && !vapidMismatch);
    pushLog.error("push failed", {
      statusCode,
      vapidMismatch,
      endpoint: endpointShort,
      body: err.body?.slice(0, 200),
      message: err.message,
    });
    return {
      ok: false,
      statusCode,
      expired,
      vapidMismatch,
      body: err.body,
    };
  }
}
