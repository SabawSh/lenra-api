/**
 * Short-lived signed token for a phone number that already passed OTP.
 * Used between OTP verify and Google link / phone signup — not a session.
 */
import { normalizeIranPhone } from "@/lib/auth/phone";
import { SignJWT, jwtVerify } from "jose";

export const PENDING_PHONE_COOKIE = "lenra_pending_phone";

const TTL_SECONDS = 10 * 60;
const ISSUER = "lenra-pending-phone";

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is missing or too short");
  }
  return new TextEncoder().encode(secret);
}

export async function createPendingPhoneToken(phone: string): Promise<string> {
  const normalized = normalizeIranPhone(phone);
  if (!normalized) throw new Error("invalid phone for pending token");
  return new SignJWT({ phone: normalized })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifyPendingPhoneToken(
  token: string,
): Promise<{ phone: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: ISSUER,
    });
    const phone = payload.phone;
    if (typeof phone !== "string") return null;
    const normalized = normalizeIranPhone(phone);
    if (!normalized || normalized !== phone) return null;
    return { phone: normalized };
  } catch {
    return null;
  }
}

export const PENDING_PHONE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: TTL_SECONDS,
};
