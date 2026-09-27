import type { PushSubscribeBody } from "@/lib/push/types";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

function bufferSourceEquals(a: BufferSource, b: Uint8Array): boolean {
  const aBytes =
    a instanceof ArrayBuffer
      ? new Uint8Array(a)
      : new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  if (aBytes.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    if (aBytes[i] !== b[i]) return false;
  }
  return true;
}

export function getVapidPublicKey(): string | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  return key || null;
}

export function isPushConfigured(): boolean {
  return Boolean(getVapidPublicKey());
}

export async function registerServiceWorker(options?: {
  checkForUpdate?: boolean;
}): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    if (options?.checkForUpdate) {
      await reg.update().catch(() => undefined);
    }
    return reg;
  } catch (e) {
    console.error("[push] service worker registration failed", e);
    return null;
  }
}

export async function isServiceWorkerActive(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return Boolean(reg?.active);
}

export async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  return registerServiceWorker();
}

function subscriptionToBody(
  sub: PushSubscription,
  platform?: string,
): PushSubscribeBody | null {
  const json = sub.toJSON();
  const keys = json.keys;
  if (!json.endpoint || !keys?.p256dh || !keys.auth) return null;
  return {
    endpoint: json.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    platform,
  };
}

export type PushSubscribeError =
  | "not_configured"
  | "no_service_worker"
  | "subscribe_failed";

export async function subscribeToPush(): Promise<
  PushSubscribeBody | { error: PushSubscribeError; detail?: string }
> {
  const vapidKey = getVapidPublicKey();
  if (!vapidKey) return { error: "not_configured" };

  const reg = await getPushRegistration();
  if (!reg) return { error: "no_service_worker" };

  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.ready;
  }

  try {
    const applicationServerKey = urlBase64ToUint8Array(vapidKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const existingKey = sub.options?.applicationServerKey;
      if (
        existingKey &&
        !bufferSourceEquals(existingKey, applicationServerKey)
      ) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[push] VAPID public key changed — resubscribing");
        }
        await sub.unsubscribe();
        sub = null;
      }
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      });
    }

    const platform =
      typeof navigator !== "undefined" ? navigator.platform : undefined;
    const body = subscriptionToBody(sub, platform);
    if (!body) return { error: "subscribe_failed" };
    return body;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { error: "subscribe_failed", detail };
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return true;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await fetch("/api/push/unsubscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => undefined);
  return true;
}

function isSubscribeBody(
  result: PushSubscribeBody | { error: PushSubscribeError },
): result is PushSubscribeBody {
  return "endpoint" in result;
}

/** Drop browser + server subscription and subscribe again (fixes VAPID rotation). */
export async function forceResubscribePush(): Promise<{
  ok: boolean;
  error?: PushSubscribeError | "server_rejected";
  detail?: string;
}> {
  await unsubscribeFromPush();
  return syncSubscriptionWithServer();
}

export async function syncSubscriptionWithServer(): Promise<{
  ok: boolean;
  error?: PushSubscribeError | "server_rejected";
  detail?: string;
}> {
  const result = await subscribeToPush();
  if (!isSubscribeBody(result)) {
    return { ok: false, error: result.error, detail: result.detail };
  }
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      ok: false,
      error: "server_rejected",
      detail: body.error,
    };
  }
  return { ok: true };
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  return Notification.requestPermission();
}
