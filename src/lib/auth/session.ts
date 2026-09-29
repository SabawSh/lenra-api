/**
 * Stateless session helpers built on top of `jose` (JWT) + an HTTP-only cookie.
 *
 * Why JWT (and not a DB session row)?
 * - The Next.js Proxy (`proxy.ts`) runs on the Edge runtime, where Prisma
 *   isn't available. JWT verification is pure crypto and works there.
 * - We can still revoke a session by clearing the cookie or rotating the secret.
 *
 * The cookie holds only a tiny payload: `{ userId }`. Everything else is loaded
 * from the DB on demand via `getCurrentUser()`.
 */
import { normalizeEnvValue } from "@/config/env";
import { isUserId } from "@/lib/db/userId";
import type { UserId } from "@/types/schema";
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "lenra_session";

/** 30 days, matching most "remember me" defaults. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const ISSUER = "lenra";
const AUDIENCE = "lenra-app";

export interface SessionPayload {
  userId: UserId;
  /** Accepted legal version embedded in JWT for Edge middleware checks. */
  lv?: string;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
    ? normalizeEnvValue(process.env.AUTH_SECRET)
    : "";
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET env var is missing or too short (need at least 32 chars). " +
        "Generate one with: openssl rand -base64 48"
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  payload: SessionPayload,
): Promise<string> {
  const claims: Record<string, string> = { uid: payload.userId };
  if (payload.lv) claims.lv = payload.lv;

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const raw = payload.uid;
    if (typeof raw !== "string" || !isUserId(raw)) return null;
    const lv = payload.lv;
    return {
      userId: raw,
      ...(typeof lv === "string" && lv.length > 0 ? { lv } : {}),
    };
  } catch {
    return null;
  }
}

/** Cookie options shared by set/clear so they always match. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
