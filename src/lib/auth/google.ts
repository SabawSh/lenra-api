/**
 * Google OAuth 2.0 helpers (Authorization Code flow, no library required).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

const SCOPES = ["openid", "email", "profile"];

export const GOOGLE_STATE_COOKIE = "lenra_g_state";
export const GOOGLE_RETURN_COOKIE = "lenra_g_next";
export const GOOGLE_INTENT_COOKIE = "lenra_g_intent";

export type GoogleOAuthIntent = "link_phone" | "link_google_settings";

export interface GoogleProfile {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

/** Canonical public origin from env (production), or null to derive from the request. */
function envPublicOrigin(): string | null {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (redirectUri) {
    try {
      return new URL(redirectUri).origin;
    } catch {
      /* invalid URL — fall through */
    }
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (base) {
    try {
      return new URL(base).origin;
    } catch {
      /* invalid URL — fall through */
    }
  }

  return null;
}

/**
 * Public origin for this request.
 * - Production: from GOOGLE_REDIRECT_URI or NEXT_PUBLIC_BASE_URL
 * - Local dev fallback: from `req.url` → http://localhost:3000
 * - Behind nginx fallback: X-Forwarded-Host / X-Forwarded-Proto
 */
export function requestOrigin(req: Request): string {
  const fromEnv = envPublicOrigin();
  if (fromEnv) return fromEnv;

  const forwardedHost = req.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = req.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();

  if (forwardedHost && forwardedProto) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(req.url).origin;
}

export function getGoogleRedirectUri(_req: Request): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;

  return new URL(GOOGLE_CALLBACK_PATH, requestOrigin(_req)).toString();
}

export function buildGoogleAuthUrl(state: string, req: Request): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", requireEnv("GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", getGoogleRedirectUri(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchangeGoogleCode(
  code: string,
  req: Request,
): Promise<{
  access_token: string;
  id_token?: string;
  expires_in: number;
}> {
  const body = new URLSearchParams({
    code,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirect_uri: getGoogleRedirectUri(req),
    grant_type: "authorization_code",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function fetchGoogleProfile(
  accessToken: string,
): Promise<GoogleProfile> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google userinfo failed (${res.status}): ${text}`);
  }
  return res.json();
}

const OAUTH_STATE_TTL_SECONDS = 10 * 60;

function oauthStateSecret(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET env var is missing or too short (need at least 32 chars).",
    );
  }
  return Buffer.from(secret, "utf8");
}

function randomOAuthNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function signOAuthStatePayload(encodedPayload: string): string {
  return createHmac("sha256", oauthStateSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function timingSafeEqualBase64Url(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface SignedOAuthStatePayload {
  next?: string;
  intent?: GoogleOAuthIntent;
}

/**
 * Signed OAuth `state` (CSRF + optional next/intent). Verified on callback without cookies,
 * so www/apex or http→https mismatches cannot cause `google_bad_state` on first sign-in.
 */
export function createSignedOAuthState(
  payload: SignedOAuthStatePayload = {},
): string {
  const body = Buffer.from(
    JSON.stringify({
      n: randomOAuthNonce(),
      exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
      ...(payload.next ? { next: payload.next } : {}),
      ...(payload.intent ? { intent: payload.intent } : {}),
    }),
  ).toString("base64url");
  return `${body}.${signOAuthStatePayload(body)}`;
}

export function verifySignedOAuthState(
  state: string,
): SignedOAuthStatePayload | null {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;

  const encoded = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  if (!timingSafeEqualBase64Url(sig, signOAuthStatePayload(encoded))) {
    return null;
  }

  try {
    const raw = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as {
      n?: unknown;
      exp?: unknown;
      next?: unknown;
      intent?: unknown;
    };
    if (typeof raw.n !== "string" || raw.n.length < 16) return null;
    if (
      typeof raw.exp !== "number" ||
      raw.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    const out: SignedOAuthStatePayload = {};
    if (typeof raw.next === "string" && raw.next.length > 0) {
      out.next = raw.next;
    }
    if (
      raw.intent === "link_phone" ||
      raw.intent === "link_google_settings"
    ) {
      out.intent = raw.intent;
    }
    return out;
  } catch {
    return null;
  }
}

/** Whether this request arrived over HTTPS (actual connection, not env canonical URL). */
export function requestIsHttps(req: Request): boolean {
  const forwardedProto = req.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedProto) return forwardedProto === "https";
  return new URL(req.url).protocol === "https:";
}

/** Cookie opts for OAuth helpers — host-only, no Domain attribute. */
export function googleOAuthCookieOptions(req: Request): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  const secure = requestIsHttps(req);
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 10 * 60,
  };
}

export function clearGoogleOAuthCookiesOnResponse(
  response: {
    cookies: { set: (name: string, value: string, options: object) => void };
  },
  req: Request,
): void {
  const opts = googleOAuthCookieOptions(req);
  for (const name of [
    GOOGLE_STATE_COOKIE,
    GOOGLE_RETURN_COOKIE,
    GOOGLE_INTENT_COOKIE,
  ]) {
    response.cookies.set(name, "", { ...opts, maxAge: 0 });
  }
}

/** Build same-origin redirect URLs (like the original `new URL(path, req.url)`). */
export function oauthRedirect(req: Request, pathname: string): URL {
  return new URL(pathname, requestOrigin(req));
}
