import { normalizeIranPhone, requestPhoneOtp } from "@/lib/auth/otp";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/auth/phone/start
 * Body: { phone: string }
 * Generates a 6-digit OTP and sends it via SMS (or echoes it in dev).
 */
export async function POST(req: Request) {
  let body: Record<string, string | number | null | undefined> | null = null;
  try {
    const parsed: any = (await req.json()) as any;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, string | number | null | undefined>;
    }
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rawPhone = String(body?.phone ?? "");

  const phone = normalizeIranPhone(rawPhone);
  if (!phone) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  const result = await requestPhoneOtp(phone);
  if (!result.ok) {
    if (result.reason === "cooldown") {
      return NextResponse.json(
        { error: "cooldown", retryAfterMs: result.retryAfterMs },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "sms_failed", detail: result.error },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    phone,
    expiresAt: result.expiresAt.toISOString(),
    debugCode: result.debugCode,
  });
}
