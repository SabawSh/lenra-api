import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";

/**
 * Lightweight gate for the Speech Replay developer panel.
 * Returns 200 for site admins, 403 otherwise. No speech logic.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isSiteMediaAdmin(user)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
