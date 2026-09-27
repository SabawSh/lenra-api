/**
 * Helpers that read or mutate the session cookie from server components,
 * server actions, and route handlers (where `next/headers` is available).
 *
 * Edge Proxy uses the lower-level `verifySessionToken` from `./session`
 * directly, since `next/headers` isn't supported there.
 */
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getApiRequest } from "./apiRequestContext";
import { readSessionFromRequest } from "./readSessionFromRequest";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  createSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "./session";

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await createSessionToken(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
}

/** Attach session to a redirect response (cookies() alone is dropped on 302). */
export async function setSessionCookieOnResponse(
  response: NextResponse,
  payload: SessionPayload,
): Promise<void> {
  const token = await createSessionToken(payload);
  response.cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
}

export async function readSessionFromCookies(): Promise<SessionPayload | null> {
  const apiRequest = getApiRequest();
  if (apiRequest) {
    return readSessionFromRequest(apiRequest);
  }
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
