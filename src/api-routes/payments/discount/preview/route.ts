import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { previewDiscountCode } from "@/lib/db/queries/discountCodes";
import {
  previewRateLimitKey,
  takePreviewToken,
} from "@/lib/payments/previewRateLimit";
import { NextResponse } from "next/server";

/**
 * GET /api/payments/discount/preview?code=SALE30
 *
 * What a discount code does to each plan. Per-user rules (uses per user,
 * first purchase only) are applied only when signed in; checkout re-checks
 * everything.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser().catch(() => null);
  if (!takePreviewToken(previewRateLimitKey(req, user?.id ?? null))) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }

  const code = new URL(req.url).searchParams.get("code") ?? "";
  try {
    const preview = await previewDiscountCode(code, user?.id ?? null);
    return NextResponse.json(preview, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[discount] preview failed", error);
    return NextResponse.json(
      { ok: false, reason: "error" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
