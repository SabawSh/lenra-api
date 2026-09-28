import { NextResponse } from "next/server";
import { clearSessionCookieOnResponse } from "@/lib/auth/sessionCookie";

export const runtime = "nodejs";

/** POST /api/auth/sign-out — clears the session cookie. */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearSessionCookieOnResponse(response);
  return response;
}
