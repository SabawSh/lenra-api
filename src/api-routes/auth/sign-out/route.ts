import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/sessionCookie";

export const runtime = "nodejs";

/** POST /api/auth/sign-out — clears the session cookie. */
export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
