import { registerViaVerifiedPhone } from "@/lib/auth/linking";
import {
  PENDING_PHONE_COOKIE,
  PENDING_PHONE_COOKIE_OPTIONS,
  readPendingPhoneFromRequest,
} from "@/lib/auth/pendingVerification";
import { postAuthRedirectPath } from "@/lib/auth/postAuthRedirect";
import { setSessionForUserOnResponse } from "@/lib/auth/setSessionForUser";
import type { JsonValue } from "@/types/json";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/auth/phone/signup
 * Body: { next? }
 * Requires OTP-verified phone in `lenra_pending_phone` cookie.
 */
export async function POST(req: Request) {
  let obj: { next?: string | null } = {};
  try {
    const parsed: JsonValue = (await req.json()) as JsonValue;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      obj = parsed as typeof obj;
    }
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const pending = await readPendingPhoneFromRequest(req);
  if (!pending) {
    return NextResponse.json({ error: "pending_phone_expired" }, { status: 401 });
  }

  const now = new Date();
  const registered = await registerViaVerifiedPhone({
    phone: pending.phone,
    phoneVerifiedAt: now,
  });

  if (!registered.ok) {
    const status = registered.code === "duplicate_provider" ? 409 : 400;
    return NextResponse.json({ error: registered.code }, { status });
  }

  const response = NextResponse.json({
    ok: true,
    user: { id: registered.user.id, username: registered.user.username },
    needsOnboarding: registered.user.onboardingCompletedAt == null,
    redirectTo: postAuthRedirectPath(
      registered.user,
      typeof obj.next === "string" ? obj.next : undefined,
    ),
  });
  response.cookies.set(PENDING_PHONE_COOKIE, "", {
    ...PENDING_PHONE_COOKIE_OPTIONS,
    maxAge: 0,
  });
  await setSessionForUserOnResponse(response, registered.user);
  return response;
}
