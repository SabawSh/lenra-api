/**
 * Google OAuth 2.0 helpers (Authorization Code flow, no library required).
 */
import { normalizeEnvValue } from "@/config/env";
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

const GOOGLE_HTTP_TIMEOUT_MS = 20_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is not set`);
  return normalizeEnvValue(value);
}

const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

function isLocalHost(host: string): boolean {
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".local") ||
    h === "0.0.0.0"
  );
}

function normalizePublicOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (
      process.env.NODE_ENV === "production" &&
      url.protocol === "http:" &&
      !isLocalHost(url.hostname)
    ) {
      url.protocol = "https:";
      return url.origin;
    }
    return url.origin;
  } catch {
    return origin;
  }
}

function originFromEnvUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    return normalizePublicOrigin(new URL(value).origin);
  } catch {
    return null;
  }
}

function requestHostname(req: Request): string {
  const forwardedHost = req.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host = forwardedHost ?? new URL(req.url).host;
  return host.split(":")[0]?.toLowerCase() ?? "";
}

/** Whether a configured public URL should drive OAuth for this request (dev vs prod). */
function envOriginAppliesToRequest(envOrigin: string, req: Request): boolean {
  let envHost: string;
  try {
    envHost = new URL(envOrigin).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (process.env.NODE_ENV === "production") {
    return !isLocalHost(envHost);
  }

  const reqHost = requestHostname(req);
  if (isLocalHost(reqHost) && !isLocalHost(envHost)) {
    return false;
  }
  return true;
}

/** Canonical public origin from env when it matches this request's environment. */
function envPublicOriginForRequest(req: Request): string | null {
  for (const raw of [
    process.env.GOOGLE_REDIRECT_URI,
    process.env.API_PUBLIC_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
  ]) {
    const origin = originFromEnvUrl(raw);
    if (origin && envOriginAppliesToRequest(origin, req)) {
      return origin;
    }
  }
  return null;
}

function assertProductionRedirectHost(uri: string): void {
  if (process.env.NODE_ENV !== "production") return;
  const host = new URL(uri).hostname;
  if (isLocalHost(host)) {
    throw new Error(
      "GOOGLE_REDIRECT_URI must not use localhost in production",
    );
  }
}

/** Redact secrets and truncate Google error bodies for logs. */
export function redactOAuthLogMessage(text: string): string {
  return text
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[REDACTED]")
    .replace(/"client_secret"\s*:\s*"[^"]+"/gi, '"client_secret":"[REDACTED]"')
    .slice(0, 500);
}

/**
 * Scheme for OAuth redirect URIs when the request is proxied without reliable TLS headers.
 * Google requires an exact match with Console-registered URIs (usually https in production).
 */
function publicRequestProto(host: string, forwardedProto: string | undefined): string {
  const proto = forwardedProto?.toLowerCase();
  if (proto === "http" || proto === "https") {
    if (
      process.env.NODE_ENV === "production" &&
      proto === "http" &&
      !isLocalHost(host)
    ) {
      return "https";
    }
    return proto;
  }
  if (isLocalHost(host)) return "http";
  return process.env.NODE_ENV === "production" ? "https" : "http";
}

/**
 * Public origin for this request.
 * - Prefer GOOGLE_REDIRECT_URI, API_PUBLIC_URL, or NEXT_PUBLIC_BASE_URL
 * - Behind proxy: X-Forwarded-Host / X-Forwarded-Proto (https assumed in production)
 * - Fallback: `req.url` origin (may be wrong when Next proxies to lenra-api over http)
 */
export function requestOrigin(req: Request): string {
  const fromEnv = envPublicOriginForRequest(req);
  if (fromEnv) return fromEnv;

  const forwardedHost = req.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = req.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();

  if (forwardedHost) {
    const proto = publicRequestProto(forwardedHost, forwardedProto);
    return `${proto}://${forwardedHost}`;
  }

  const origin = new URL(req.url).origin;
  try {
    const { hostname, protocol } = new URL(origin);
    if (
      process.env.NODE_ENV === "production" &&
      protocol === "http:" &&
      !isLocalHost(hostname)
    ) {
      return `https://${hostname}${new URL(origin).port ? `:${new URL(origin).port}` : ""}`;
    }
  } catch {
    /* keep origin */
  }
  return origin;
}

function normalizeRedirectUri(uri: string): string {
  try {
    const url = new URL(uri);
    if (
      process.env.NODE_ENV === "production" &&
      url.protocol === "http:" &&
      !isLocalHost(url.hostname)
    ) {
      url.protocol = "https:";
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return uri;
  }
}

function assertOAuthCallbackRedirectUri(uri: string): string {
  const normalized = normalizeRedirectUri(uri);
  const path = new URL(normalized).pathname;
  if (path !== GOOGLE_CALLBACK_PATH) {
    throw new Error("Invalid Google OAuth redirect_uri path");
  }
  return normalized;
}

export function getGoogleRedirectUri(req: Request): string {
  const rawExplicit = process.env.GOOGLE_REDIRECT_URI;
  if (rawExplicit?.trim()) {
    const uri = assertOAuthCallbackRedirectUri(normalizeEnvValue(rawExplicit));
    if (envOriginAppliesToRequest(new URL(uri).origin, req)) {
      assertProductionRedirectHost(uri);
      return uri;
    }
  }

  const uri = assertOAuthCallbackRedirectUri(
    new URL(GOOGLE_CALLBACK_PATH, requestOrigin(req)).toString(),
  );
  assertProductionRedirectHost(uri);
  return uri;
}

/** Redirect URI from signed state (callback), or derived from the request. */
export function resolveGoogleRedirectUriForCallback(
  req: Request,
  signed: SignedOAuthStatePayload | null,
): string {
  if (signed?.redirectUri) {
    return assertOAuthCallbackRedirectUri(signed.redirectUri);
  }
  return getGoogleRedirectUri(req);
}

export function buildGoogleAuthUrl(
  state: string,
  req: Request,
  redirectUri?: string,
): string {
  const resolvedRedirect = redirectUri ?? getGoogleRedirectUri(req);
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", requireEnv("GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", resolvedRedirect);
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
  redirectUri?: string,
): Promise<{
  access_token: string;
  id_token?: string;
  expires_in: number;
}> {
  const resolvedRedirect =
    redirectUri != null
      ? assertOAuthCallbackRedirectUri(redirectUri)
      : getGoogleRedirectUri(req);

  const body = new URLSearchParams({
    code,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirect_uri: resolvedRedirect,
    grant_type: "authorization_code",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(GOOGLE_HTTP_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google token exchange failed (${res.status}): ${redactOAuthLogMessage(text)}`,
    );
  }
  return res.json();
}

export async function fetchGoogleProfile(
  accessToken: string,
): Promise<GoogleProfile> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GOOGLE_HTTP_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google userinfo failed (${res.status}): ${redactOAuthLogMessage(text)}`,
    );
  }
  return res.json();
}

const OAUTH_STATE_TTL_SECONDS = 10 * 60;

function oauthStateSecret(): Buffer {
  const secret = process.env.AUTH_SECRET
    ? normalizeEnvValue(process.env.AUTH_SECRET)
    : "";
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
  /** Exact redirect_uri sent to Google on /start (token exchange must match). */
  redirectUri?: string;
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
      ...(payload.redirectUri ? { ru: payload.redirectUri } : {}),
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
      ru?: unknown;
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
    if (typeof raw.ru === "string" && raw.ru.length > 0) {
      try {
        out.redirectUri = assertOAuthCallbackRedirectUri(raw.ru);
      } catch {
        return null;
      }
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

/** Safe relative post-login path for signed OAuth state (blocks open redirects). */
export function sanitizeOAuthNext(raw: string | null | undefined): string {
  const n = typeof raw === "string" ? raw.trim() : "";
  if (n.startsWith("/") && !n.startsWith("//")) return n;
  return "/";
}

/** Build same-origin redirect URLs (like the original `new URL(path, req.url)`). */
export function oauthRedirect(req: Request, pathname: string): URL {
  return new URL(pathname, requestOrigin(req));
}
