import {
  loginViaVerifiedPhone,
  resolveUserIdFromVerifiedPhone,
} from "@/lib/auth/linking";
import { normalizeIranPhone, verifyPhoneOtp } from "@/lib/auth/otp";
import {
  createPendingPhoneToken,
  PENDING_PHONE_COOKIE,
  PENDING_PHONE_COOKIE_OPTIONS,
} from "@/lib/auth/pendingVerification";
import { postAuthRedirectPath } from "@/lib/auth/postAuthRedirect";
import { setSessionForUserOnResponse } from "@/lib/auth/setSessionForUser";
import { updateUserLastActiveNow } from "@/lib/db/queries/users";
import type { JsonValue } from "@/types/json";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/auth/phone/verify
 * Body: { phone, code, purpose?: "login" | "link_settings" }
 *
 * Existing phone auth method → session.
 * Unknown phone → pending token + needs_account_choice (no silent signup).
 */
export async function POST(req: Request) {
  let obj: {
    phone?: string | number | null;
    code?: string | number | null;
    purpose?: string | null;
    next?: string | null;
  } = {};
  try {
    const parsed: JsonValue = (await req.json()) as JsonValue;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      obj = parsed as typeof obj;
    }
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const phone = normalizeIranPhone(String(obj.phone ?? ""));
  const code = String(obj.code ?? "").trim();
  const purpose = obj.purpose === "link_settings" ? "link_settings" : "login";

  if (!phone) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "invalid_code_format" }, { status: 400 });
  }

  const result = await verifyPhoneOtp(phone, code);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 401 });
  }

  const now = new Date();
  const existingUserId = await resolveUserIdFromVerifiedPhone(phone);

  if (purpose === "link_settings") {
    const { readSessionFromCookies } = await import("@/lib/auth/sessionCookie");
    const session = await readSessionFromCookies();
    if (!session) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }
    if (existingUserId && existingUserId !== session.userId) {
      return NextResponse.json(
        { error: "phone_linked_elsewhere" },
        { status: 409 },
      );
    }
    const { linkVerifiedPhoneToUser } = await import("@/lib/auth/linking");
    const linked = await linkVerifiedPhoneToUser(session.userId, phone, now);
    if (!linked.ok) {
      return NextResponse.json({ error: linked.code }, { status: 409 });
    }
    return NextResponse.json({ ok: true, linked: true });
  }

  if (existingUserId) {
    const user = await loginViaVerifiedPhone(phone, now);
    if (!user) {
      return NextResponse.json({ error: "user_not_found" }, { status: 500 });
    }
    await updateUserLastActiveNow(user.id);
    const clientNext =
      typeof obj.next === "string" ? obj.next : undefined;

    const response = NextResponse.json({
      ok: true,
      status: "logged_in",
      user: { id: user.id, name: user.name, phone: user.phone },
      needsOnboarding: user.onboardingCompletedAt == null,
      redirectTo: postAuthRedirectPath(user, clientNext),
    });
    await setSessionForUserOnResponse(response, user);
    return response;
  }

  const pendingToken = await createPendingPhoneToken(phone);
  const response = NextResponse.json({
    ok: true,
    status: "needs_account_choice",
    phone,
  });
  response.cookies.set(
    PENDING_PHONE_COOKIE,
    pendingToken,
    PENDING_PHONE_COOKIE_OPTIONS,
  );
  return response;
}
