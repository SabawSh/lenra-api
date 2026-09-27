import { createHmac, timingSafeEqual } from "node:crypto";
import type { BitpayPlanKey } from "@/lib/payments/plans";
import { isBitpayPlanKey } from "@/lib/payments/plans";
import type { UserId } from "@/types/schema";

const CHECKOUT_STATE_TTL_SECONDS = 30 * 60;

function checkoutStateSecret(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET env var is missing or too short (need at least 32 chars).",
    );
  }
  return Buffer.from(secret, "utf8");
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", checkoutStateSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function timingSafeEqualBase64Url(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface CheckoutStatePayload {
  userId: UserId;
  plan: BitpayPlanKey;
  locale: string;
}

export function createCheckoutState(payload: CheckoutStatePayload): string {
  const body = Buffer.from(
    JSON.stringify({
      userId: payload.userId,
      plan: payload.plan,
      locale: payload.locale,
      exp: Math.floor(Date.now() / 1000) + CHECKOUT_STATE_TTL_SECONDS,
    }),
  ).toString("base64url");
  return `${body}.${signPayload(body)}`;
}

export function verifyCheckoutState(state: string): CheckoutStatePayload | null {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;

  const encoded = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  if (!timingSafeEqualBase64Url(sig, signPayload(encoded))) {
    return null;
  }

  try {
    const raw = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as {
      userId?: unknown;
      plan?: unknown;
      locale?: unknown;
      exp?: unknown;
    };

    if (typeof raw.userId !== "string" || raw.userId.length < 8) return null;
    if (typeof raw.plan !== "string" || !isBitpayPlanKey(raw.plan)) return null;
    if (typeof raw.locale !== "string" || raw.locale.length === 0) return null;
    if (
      typeof raw.exp !== "number" ||
      raw.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return {
      userId: raw.userId as UserId,
      plan: raw.plan,
      locale: raw.locale,
    };
  } catch {
    return null;
  }
}
