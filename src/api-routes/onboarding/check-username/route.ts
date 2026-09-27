import { existsOtherUsername } from "@/lib/db/queries/users";
import { readSessionFromCookies } from "@/lib/auth/sessionCookie";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

/**
 * GET /api/onboarding/check-username?username=xxx
 * Returns { available: boolean, error?: string }
 * `error` is set when the value is syntactically invalid.
 */
export async function GET(req: Request) {
  const session = await readSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const username = (searchParams.get("username") ?? "").toLowerCase().trim();

  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({
      available: false,
      error:
        username.length < 3
          ? "At least 3 characters"
          : username.length > 30
            ? "Max 30 characters"
            : "Only letters, numbers and underscores",
    });
  }

  const taken = await existsOtherUsername(username, session.userId);

  return NextResponse.json({ available: !taken });
}
